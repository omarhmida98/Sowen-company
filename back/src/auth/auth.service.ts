import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto, ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import type { AuthUser, TokenPayload } from './auth.types';
import { passwordProblem } from './password-policy';
import { AuthRateLimit } from './rate-limiter';
import { hashToken, isUsable } from './account-links';
import { refreshDecision, ttlMs } from './sessions';
import { isRealInstallation } from '../config.validation';

const BAD_CREDENTIALS = 'Email ou mot de passe incorrect.';
const BAD_LINK = 'Ce lien est invalide ou a expiré. Demandez un nouveau lien à votre administrateur.';
// Compared against when the account does not exist or has no password yet, so that the answer takes the same time.
const DUMMY_HASH = bcrypt.hashSync('sowen-no-such-account', 12);

type SessionUser = { id: string; email: string; displayName: string | null; role: AuthUser['role']; organizationId: string; tokenVersion: number };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(private prisma: PrismaService, private jwt: JwtService, private config: ConfigService, private limit: AuthRateLimit) {}

  private refreshTtlMs() { return ttlMs(this.config.get('JWT_REFRESH_TTL'), 30 * 86400000); }

  // Both tokens carry the id of a server-side session (`sid`): revoking the session ends them at once. `ver` is the
  // user's token version (a password change or reset increases it). The refresh token also carries `rid`, which
  // changes at every renewal.
  private async tokens(user: SessionUser, session: { id: string; refreshId: string }) {
    const payload: TokenPayload = { sub: user.id, email: user.email, role: user.role, organizationId: user.organizationId, ver: user.tokenVersion, sid: session.id };
    const access = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL') ?? '15m',
    });
    const refresh = await this.jwt.signAsync({ ...payload, rid: session.refreshId }, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: Math.round(this.refreshTtlMs() / 1000),
    });
    return { accessToken: access, refreshToken: refresh };
  }

  // Sign-in events: who and from where. Never a password, a token or what was typed.
  private async audit(userId: string, action: string, ip?: string, entityId?: string) {
    try { await this.prisma.activityLog.create({ data: { userId, action, entityType: 'Session', entityId: entityId ?? null, metadata: { ip: ip || null } } }); } catch { /* the audit trail never blocks a sign-in */ }
  }

  private async endSessions(userId: string, reason: string) {
    await this.prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  private publicUser(user: { id: string; email: string; displayName: string | null; role: AuthUser['role']; organizationId: string }) {
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, organizationId: user.organizationId };
  }

  // Opens a new server-side session for the user and returns its tokens.
  private async session(user: SessionUser) {
    const now = new Date();
    // Sessions of this user that expired are cleared on the way.
    await this.prisma.authSession.deleteMany({ where: { userId: user.id, expiresAt: { lt: now } } });
    const session = await this.prisma.authSession.create({ data: { userId: user.id, refreshId: randomUUID(), expiresAt: new Date(now.getTime() + this.refreshTtlMs()) } });
    return { user: this.publicUser(user), ...(await this.tokens(user, session)) };
  }

  // Self-registration (/register) creates an organisation and its administrator.
  //  - ALLOW_PUBLIC_REGISTRATION="true": open to anyone.
  //  - otherwise, on a real installation (production, or a public address): always closed. The first administrator
  //    is created on the server with "npm --workspace back run admin:create", so the first visitor of an empty
  //    installation cannot take it over.
  //  - otherwise (local development): open until the first account exists.
  async registrationOpen() {
    if ((this.config.get<string>('ALLOW_PUBLIC_REGISTRATION') || '').trim().toLowerCase() === 'true') return true;
    if (isRealInstallation({ NODE_ENV: this.config.get('NODE_ENV'), PUBLIC_APP_URL: this.config.get('PUBLIC_APP_URL') })) return false;
    return (await this.prisma.user.count()) === 0;
  }

  async register(dto: RegisterDto, ip?: string) {
    if (!(await this.registrationOpen())) throw new ForbiddenException('La création de compte est désactivée. Demandez à un administrateur de vous ajouter.');
    const attempt = await this.limit.begin('register', { ip });
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
    await this.limit.succeeded(attempt);
    await this.audit(result.user.id, 'Compte créé', ip);
    return this.session(result.user);
  }

  // The answer is the same for an unknown account, an account that has not set its password yet and a wrong password.
  async login(dto: LoginDto, ip?: string) {
    const email = dto.email.trim().toLowerCase();
    // The attempt is counted before the password is checked; a success gives it back and clears the account counters.
    const attempt = await this.limit.begin('login', { ip, account: email });
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(dto.password, user?.passwordHash || DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) {
      if (user) await this.audit(user.id, 'Échec de connexion', ip);
      else this.logger.warn(`Failed sign-in for an unknown account from ${ip || 'unknown address'}`);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }
    await this.limit.succeeded(attempt);
    const session = await this.session(user);
    await this.audit(user.id, 'Connexion', ip);
    return session;
  }

  // Renews a session. The refresh token is replaced each time (rotation): the one presented stops being valid.
  // Presenting a refresh token that was already replaced means it was copied: the whole session is ended.
  async refresh(dto: RefreshDto, ip?: string) {
    const attempt = await this.limit.begin('refresh', { ip });
    const invalid = new UnauthorizedException('Invalid or expired refresh token');
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(dto.refreshToken, { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET') });
    } catch { throw invalid; }
    if (!payload.sid || !payload.rid) throw invalid;
    let session = await this.prisma.authSession.findUnique({ where: { id: payload.sid } });
    const user = session ? await this.prisma.user.findUnique({ where: { id: session.userId } }) : null;
    // A removed user, or a session opened before a password change or reset, cannot be renewed.
    if (!session || !user || !user.passwordHash || session.userId !== payload.sub || (payload.ver ?? 0) !== user.tokenVersion) throw invalid;

    let decision = refreshDecision(session, payload.rid);
    if (decision === 'ROTATE') {
      const now = new Date(), refreshId = randomUUID();
      const claimed = await this.prisma.authSession.updateMany({ where: { id: session.id, refreshId: payload.rid, revokedAt: null }, data: { refreshId, previousRefreshId: payload.rid, rotatedAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + this.refreshTtlMs()) } });
      if (claimed.count) session = { ...session, refreshId };
      else {
        // Another request renewed the session at the same instant: this one is given the same new token.
        session = await this.prisma.authSession.findUnique({ where: { id: session.id } });
        if (!session) throw invalid;
        decision = refreshDecision(session, payload.rid);
        if (decision === 'ROTATE') throw invalid;
      }
    }
    if (decision === 'REUSED') {
      await this.prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'refresh-token-reuse' } });
      await this.audit(user.id, 'Session fermée : un ancien jeton de session a été réutilisé', ip, session.id);
      throw invalid;
    }
    if (decision === 'DEAD') throw invalid;
    await this.limit.succeeded(attempt);
    return { user: this.publicUser(user), ...(await this.tokens(user, session)) };
  }

  // Signs out: the session is revoked on the server, so its access and refresh tokens stop working at once, even
  // if somebody kept a copy. Always answers the same way.
  async logout(refreshToken: string, ip?: string) {
    try {
      const payload = await this.jwt.verifyAsync<TokenPayload>(refreshToken, { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), ignoreExpiration: true });
      if (payload.sid) {
        const ended = await this.prisma.authSession.updateMany({ where: { id: payload.sid, userId: payload.sub, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'logout' } });
        if (ended.count) await this.audit(payload.sub, 'Déconnexion', ip, payload.sid);
      }
    } catch { /* an unreadable token has no session to end */ }
    return { loggedOut: true };
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
    await this.endSessions(userId, 'password-changed');
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
    await this.endSessions(user.id, 'password-set');
    await this.prisma.activityLog.create({ data: { userId: user.id, action: row.type === 'INVITATION' ? 'Invitation acceptée' : 'Mot de passe réinitialisé par lien', entityType: 'User', entityId: user.id } });
    return this.session(user);
  }
}
