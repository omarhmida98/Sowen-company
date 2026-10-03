import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto, ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import type { AuthUser, TokenPayload } from './auth.types';
import { passwordProblem } from './password-policy';
import { AuthRateLimit } from './rate-limiter';
import { hashToken, isUsable } from './account-links';

const BAD_CREDENTIALS = 'Email ou mot de passe incorrect.';
const BAD_LINK = 'Ce lien est invalide ou a expiré. Demandez un nouveau lien à votre administrateur.';
// Compared against when the account does not exist or has no password yet, so that the answer takes the same time.
const DUMMY_HASH = bcrypt.hashSync('sowen-no-such-account', 12);

type SessionUser = { id: string; email: string; displayName: string | null; role: AuthUser['role']; organizationId: string; tokenVersion: number };

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private config: ConfigService, private limit: AuthRateLimit) {}

  // `ver` is the user's token version: changing or resetting a password increases it, which ends every session
  // opened before (see AuthGuard and refresh()).
  private async tokens(user: SessionUser) {
    const payload: TokenPayload = { sub: user.id, email: user.email, role: user.role, organizationId: user.organizationId, ver: user.tokenVersion };
    const access = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL') ?? '15m',
    });
    const refresh = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_TTL') ?? '30d',
    });
    return { accessToken: access, refreshToken: refresh };
  }

  private publicUser(user: { id: string; email: string; displayName: string | null; role: AuthUser['role']; organizationId: string }) {
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, organizationId: user.organizationId };
  }

  private async session(user: SessionUser) {
    return { user: this.publicUser(user), ...(await this.tokens(user)) };
  }

  // Self-registration is closed once the installation has its first account, unless ALLOW_PUBLIC_REGISTRATION=true.
  // Further users are invited by an administrator from the team page.
  async registrationOpen() {
    if ((this.config.get<string>('ALLOW_PUBLIC_REGISTRATION') || '').trim().toLowerCase() === 'true') return true;
    return (await this.prisma.user.count()) === 0;
  }

  async register(dto: RegisterDto) {
    if (!(await this.registrationOpen())) throw new ForbiddenException('La création de compte est désactivée. Demandez à un administrateur de vous ajouter.');
    const email = dto.email.trim().toLowerCase();
    const problem = passwordProblem(dto.password, { email });
    if (problem) throw new BadRequestException(problem);
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('Email already used');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const result = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: dto.organizationName.trim() } });
      const user = await tx.user.create({ data: { email, displayName: dto.displayName.trim(), passwordHash, passwordChangedAt: new Date(), role: 'ADMIN', organizationId: org.id } });
      return { org, user };
    });
    return this.session(result.user);
  }

  // The answer is the same for an unknown account, an account that has not set its password yet and a wrong password.
  async login(dto: LoginDto, ip?: string) {
    const email = dto.email.trim().toLowerCase();
    // The attempt is counted before the password is checked; a success gives it back and clears the account counters.
    const attempt = await this.limit.begin('login', { ip, account: email });
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(dto.password, user?.passwordHash || DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) throw new UnauthorizedException(BAD_CREDENTIALS);
    await this.limit.succeeded(attempt);
    return this.session(user);
  }

  async refresh(dto: RefreshDto, ip?: string) {
    const attempt = await this.limit.begin('refresh', { ip });
    try {
      const payload = await this.jwt.verifyAsync<TokenPayload>(dto.refreshToken, { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET') });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      // A removed user, or a session opened before a password change or reset, cannot be renewed.
      if (!user || !user.passwordHash || (payload.ver ?? 0) !== user.tokenVersion) throw new UnauthorizedException();
      const session = await this.session(user);
      await this.limit.succeeded(attempt);
      return session;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: true } });
    if (!user) throw new UnauthorizedException('User not found');
    return { ...this.publicUser(user), passwordChangedAt: user.passwordChangedAt, organization: { id: user.organization.id, name: user.organization.name, senderEmail: user.organization.senderEmail, reminderDays: user.organization.reminderDays } };
  }

  // The signed-in user changes their own password. Every other session of that user ends; this one receives new tokens.
  async changePassword(userId: string, dto: ChangePasswordDto, ip?: string) {
    const attempt = await this.limit.begin('password', { ip, account: userId });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('User not found');
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) throw new BadRequestException('Le mot de passe actuel est incorrect.');
    // The current password is proven: what follows is validation of the new one, not guessing.
    await this.limit.succeeded(attempt);
    if (dto.newPassword !== dto.confirmPassword) throw new BadRequestException('La confirmation ne correspond pas au nouveau mot de passe.');
    if (dto.newPassword === dto.currentPassword) throw new BadRequestException('Le nouveau mot de passe doit être différent de l’actuel.');
    const problem = passwordProblem(dto.newPassword, { email: user.email });
    if (problem) throw new BadRequestException(problem);
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(dto.newPassword, 12), passwordChangedAt: new Date(), tokenVersion: { increment: 1 } } });
    await this.prisma.userToken.deleteMany({ where: { userId } });
    await this.prisma.activityLog.create({ data: { userId, action: 'Mot de passe modifié', entityType: 'User', entityId: userId } });
    return this.session(updated);
  }

  private async usableToken(token: string, ip?: string) {
    const attempt = await this.limit.begin('link', { ip });
    const row = typeof token === 'string' && token.length >= 20 ? await this.prisma.userToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { organization: { select: { name: true } } } } } }) : null;
    if (!row || !isUsable(row)) throw new NotFoundException(BAD_LINK);
    await this.limit.succeeded(attempt);
    return row;
  }

  // What the invitation / reset page shows. Nothing is revealed for an unknown, used or expired link.
  async invitation(token: string, ip?: string) {
    const row = await this.usableToken(token, ip);
    return { type: row.type, email: row.user.email, displayName: row.user.displayName, organizationName: row.user.organization.name, expiresAt: row.expiresAt };
  }

  // The invited (or reset) user chooses their password. The link works once: it is claimed atomically.
  async acceptInvitation(dto: AcceptInvitationDto, ip?: string) {
    const row = await this.usableToken(dto.token, ip);
    if (dto.password !== dto.confirmPassword) throw new BadRequestException('La confirmation ne correspond pas au mot de passe.');
    const problem = passwordProblem(dto.password, { email: row.user.email });
    if (problem) throw new BadRequestException(problem);
    const claim = await this.prisma.userToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (!claim.count) throw new NotFoundException(BAD_LINK);
    const user = await this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(dto.password, 12), passwordChangedAt: new Date(), tokenVersion: { increment: 1 } } });
    // Any other pending link of this user stops working.
    await this.prisma.userToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await this.prisma.activityLog.create({ data: { userId: user.id, action: row.type === 'INVITATION' ? 'Invitation acceptée' : 'Mot de passe réinitialisé par lien', entityType: 'User', entityId: user.id } });
    return this.session(user);
  }
}
