import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthUser, TokenPayload } from '../auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, private config: ConfigService, private prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest();
    const header = req.headers?.authorization as string | undefined;
    const [type, token] = header?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('Authentication required');
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token, { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET') });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    // The token proves who is calling; what they may do is read from the database on every request. A removed user,
    // a changed role, or a password change or reset (token version) therefore takes effect immediately, without
    // waiting for the access token to expire.
    // The token also names a server-side session: signing out (or a detected token theft) revokes it, and the token
    // is refused from then on even though it has not expired.
    const session = payload.sid ? await this.prisma.authSession.findUnique({ where: { id: payload.sid }, select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { id: true, email: true, role: true, organizationId: true, tokenVersion: true, passwordHash: true } } } }) : null;
    const user = session?.user;
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.userId !== payload.sub || !user || !user.passwordHash || (payload.ver ?? 0) !== user.tokenVersion) throw new UnauthorizedException('Invalid or expired access token');
    req.user = { sub: user.id, email: user.email, role: user.role, organizationId: user.organizationId, sid: payload.sid } satisfies AuthUser;
    return true;
  }
}
