import {
  changePasswordRequestSchema,
  loginRequestSchema,
  mfaVerifyRequestSchema,
  recoveryCodeRequestSchema,
  reauthRequestSchema,
  totpConfirmRequestSchema,
} from '@iam/contracts';
import type {
  SessionSummary,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  MfaVerifyRequest,
  ReauthRequest,
  RecoveryCodeRequest,
  TotpConfirmRequest,
  TotpConfirmResponse,
  TotpEnrollResponse,
} from '@iam/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  PartialSession,
  Public,
  RateLimited,
  unwrap,
} from '../../../shared/http/http-decorators.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { REAUTH_WINDOW_MS } from '../../access/index.js';
import { ListMySessions, RevokeMySession } from '../application/my-sessions.js';
import { GetProfile } from '../application/profile.js';
import { ChangePassword } from '../application/change-password.js';
import { Login } from '../application/login.js';
import { Logout } from '../application/logout.js';
import { SecondFactor } from '../application/second-factor.js';
import type { MeResponse } from '@iam/contracts';
import { DomainError } from '../../../shared/kernel/index.js';

@RateLimited()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly login: Login,
    private readonly logout: Logout,
    private readonly secondFactor: SecondFactor,
    private readonly changePassword: ChangePassword,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async signIn(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const outcome = unwrap(
      await this.login.execute({
        email: body.email,
        password: body.password,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        requestId: request.id,
      }),
    );
    setSessionCookie(reply, outcome.token, outcome.expiresAt);
    return { status: outcome.status };
  }

  /** Acepta sesión a medias: la contraseña inicial de la Raíz se cambia antes de registrar el segundo factor. */
  @PartialSession()
  @Post('password/change')
  @HttpCode(204)
  async changePasswordEndpoint(
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    unwrap(
      await this.changePassword.execute({
        ...body,
        mfaVerified: request.principal?.mfaVerified === true,
      }),
    );
  }

  @PartialSession()
  @Post('mfa/verify')
  @HttpCode(204)
  async verifyTotp(
    @Body(new ZodValidationPipe(mfaVerifyRequestSchema)) body: MfaVerifyRequest,
  ): Promise<void> {
    unwrap(await this.secondFactor.verifyTotp(body.code));
  }

  @PartialSession()
  @Post('mfa/recovery')
  @HttpCode(204)
  async verifyRecovery(
    @Body(new ZodValidationPipe(recoveryCodeRequestSchema)) body: RecoveryCodeRequest,
  ): Promise<void> {
    unwrap(await this.secondFactor.verifyRecoveryCode(body.code));
  }

  @PartialSession()
  @Post('mfa/totp/enroll')
  @HttpCode(200)
  async beginEnrollment(): Promise<TotpEnrollResponse> {
    const result = unwrap(await this.secondFactor.beginTotpEnrollment());
    return { secret: result.secret, otpauthUri: result.otpauthUri };
  }

  @PartialSession()
  @Post('mfa/totp/confirm')
  @HttpCode(200)
  async confirmEnrollment(
    @Body(new ZodValidationPipe(totpConfirmRequestSchema)) body: TotpConfirmRequest,
  ): Promise<TotpConfirmResponse> {
    const result = unwrap(await this.secondFactor.confirmTotpEnrollment(body.code));
    return { recoveryCodes: result.recoveryCodes };
  }

  @Post('reauth')
  @HttpCode(204)
  async reauthenticate(
    @Body(new ZodValidationPipe(reauthRequestSchema)) body: ReauthRequest,
  ): Promise<void> {
    unwrap(await this.secondFactor.reauthenticate(body.code));
  }

  @PartialSession()
  @Post('logout')
  @HttpCode(204)
  async signOut(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.logout.execute();
    clearSessionCookie(reply);
  }
}

@Controller('me')
export class MeController {
  constructor(
    private readonly profile: GetProfile,
    private readonly listMySessions: ListMySessions,
    private readonly revokeMySession: RevokeMySession,
  ) {}

  @Get('sessions')
  async sessions(): Promise<{ data: SessionSummary[] }> {
    const sessions = await this.listMySessions.execute();
    return {
      data: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        userAgent: s.userAgent,
        ip: s.ip,
        current: s.current,
      })),
    };
  }

  @Post('sessions/:id/revoke')
  @HttpCode(204)
  async revokeSession(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<void> {
    unwrap(await this.revokeMySession.execute(id));
  }

  @Get()
  async me(@Req() request: FastifyRequest): Promise<MeResponse> {
    const principal = request.principal;
    if (principal === undefined) throw new DomainError('AUTHZ.SESSION', 'Authentication required');
    const profile = await this.profile.execute(principal);
    const reauthUntil =
      principal.reauthAt === null
        ? null
        : new Date(principal.reauthAt.getTime() + REAUTH_WINDOW_MS);
    return {
      user: profile.user,
      permissions: [...profile.permissions],
      session: {
        expiresAt: principal.expiresAt.toISOString(),
        reauthUntil:
          reauthUntil !== null && reauthUntil > new Date() ? reauthUntil.toISOString() : null,
      },
    };
  }
}
