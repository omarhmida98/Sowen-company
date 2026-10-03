import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AcceptInvitationDto, ChangePasswordDto, InvitationLookupDto, LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './auth.types';
@Controller('auth')
export class AuthController {
  constructor(private service: AuthService) {}
  @Public() @Get('registration') async registration() { return { open: await this.service.registrationOpen() }; }
  @Public() @Post('register') register(@Body() dto: RegisterDto) { return this.service.register(dto); }
  @Public() @Post('login') login(@Body() dto: LoginDto, @Ip() ip: string) { return this.service.login(dto, ip); }
  @Public() @Post('refresh') refresh(@Body() dto: RefreshDto, @Ip() ip: string) { return this.service.refresh(dto, ip); }
  @Get('me') me(@CurrentUser() user: AuthUser) { return this.service.me(user.sub); }
  @Post('change-password') @HttpCode(200) changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthUser, @Ip() ip: string) { return this.service.changePassword(user.sub, dto, ip); }
  // The token travels in the body, never in the URL, so it does not end up in request logs.
  @Public() @Post('invitation') @HttpCode(200) invitation(@Body() dto: InvitationLookupDto, @Ip() ip: string) { return this.service.invitation(dto.token, ip); }
  @Public() @Post('invitation/accept') @HttpCode(200) accept(@Body() dto: AcceptInvitationDto, @Ip() ip: string) { return this.service.acceptInvitation(dto, ip); }
}
