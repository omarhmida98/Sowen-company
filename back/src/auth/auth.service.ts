import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import type { AuthUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private config: ConfigService) {}

  private async tokens(userId: string, email: string, role: AuthUser['role'], organizationId: string) {
    const payload: AuthUser = { sub: userId, email, role, organizationId };
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

  // Self-registration is closed once the installation has its first account, unless ALLOW_PUBLIC_REGISTRATION=true.
  // Further users are created by an administrator from the team page.
  async registrationOpen() {
    if ((this.config.get<string>('ALLOW_PUBLIC_REGISTRATION') || '').trim().toLowerCase() === 'true') return true;
    return (await this.prisma.user.count()) === 0;
  }

  async register(dto: RegisterDto) {
    if (!(await this.registrationOpen())) throw new ForbiddenException('La création de compte est désactivée. Demandez à un administrateur de vous ajouter.');
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('Email already used');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const result = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: dto.organizationName.trim() } });
      const user = await tx.user.create({ data: { email, displayName: dto.displayName.trim(), passwordHash, role: 'ADMIN', organizationId: org.id } });
      return { org, user };
    });
    return { user: this.publicUser(result.user), ...(await this.tokens(result.user.id, result.user.email, result.user.role, result.user.organizationId)) };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw new UnauthorizedException('Invalid credentials');
    return { user: this.publicUser(user), ...(await this.tokens(user.id, user.email, user.role, user.organizationId)) };
  }

  async refresh(dto: RefreshDto) {
    try {
      const payload = await this.jwt.verifyAsync<AuthUser>(dto.refreshToken, { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET') });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException('User not found');
      return { user: this.publicUser(user), ...(await this.tokens(user.id, user.email, user.role, user.organizationId)) };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: true } });
    if (!user) throw new UnauthorizedException('User not found');
    return { ...this.publicUser(user), organization: { id: user.organization.id, name: user.organization.name, senderEmail: user.organization.senderEmail, reminderDays: user.organization.reminderDays } };
  }
}
