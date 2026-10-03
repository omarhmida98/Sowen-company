import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthRateLimit } from './rate-limiter';
@Module({ imports: [JwtModule.register({})], controllers: [AuthController], providers: [AuthService, AuthGuard, RolesGuard, AuthRateLimit], exports: [AuthService, JwtModule, AuthGuard, RolesGuard] })
export class AuthModule {}
