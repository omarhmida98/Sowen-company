import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './auth.types';
@Controller('auth')
export class AuthController {
  constructor(private service: AuthService) {}
  @Public() @Get('registration') async registration() { return { open: await this.service.registrationOpen() }; }
  @Public() @Post('register') register(@Body() dto: RegisterDto) { return this.service.register(dto); }
  @Public() @Post('login') login(@Body() dto: LoginDto) { return this.service.login(dto); }
  @Public() @Post('refresh') refresh(@Body() dto: RefreshDto) { return this.service.refresh(dto); }
  @Get('me') me(@CurrentUser() user: AuthUser) { return this.service.me(user.sub); }
}
