import {
  changePasswordRequestSchema,
  loginRequestSchema,
  passkeyLoginRequestSchema,
  registerPasskeyRequestSchema,
  mfaVerifyRequestSchema,
  recoveryCodeRequestSchema,
  reauthPasskeyRequestSchema,
  reauthRequestSchema,
  totpConfirmRequestSchema,
} from '@iam/contracts';
import type {
  Passkey,
  PasskeyLoginRequest,
  RegisterPasskeyRequest,
  SessionSummary,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  MfaVerifyRequest,
  ReauthPasskeyRequest,
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
import { Passkeys } from '../application/passkeys.js';
import { GetProfile } from '../application/profile.js';
import { ChangePassword } from '../application/change-password.js';
import { Login } from '../application/login.js';
import { Logout } from '../application/logout.js';
import { SecondFactor } from '../application/second-factor.js';
import type { MeResponse } from '@iam/contracts';
import { DomainError } from '../../../shared/kernel/index.js';

/**
 * Reemplaza la cookie de sesión por la del token rotado. La caducidad absoluta no cambia: la sesión es
 * la misma fila, solo cambia su token.
 */
function setRotatedSessionCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  sessionToken: string,
): void {
  const principal = request.principal;
  if (principal === undefined) {
    throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
  }
  setSessionCookie(reply, sessionToken, principal.expiresAt);
}

@RateLimited()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly login: Login,
    private readonly logout: Logout,
    private readonly secondFactor: SecondFactor,
    private readonly changePassword: ChangePassword,
  ) {}

  /** Paso 1 del inicio de sesión con llave de acceso (contraseña ya verificada, segundo factor pendiente). */
  @PartialSession()
  @Post('passkey/options')
  @HttpCode(200)
  async passkeyOptions(): Promise<unknown> {
    return unwrap(await this.secondFactor.beginPasskeyLogin()).options;
  }

  @PartialSession()
  @Post('passkey/verify')
  @HttpCode(204)
  async passkeyVerify(
    @Body(new ZodValidationPipe(passkeyLoginRequestSchema)) body: PasskeyLoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const rotated = unwrap(await this.secondFactor.verifyPasskey(body.response));
    setRotatedSessionCookie(reply, request, rotated.sessionToken);
  }

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
    return outcome.status === 'mfa_required'
      ? { status: outcome.status, passkeys: outcome.passkeys }
      : { status: outcome.status };
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
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const rotated = unwrap(await this.secondFactor.verifyTotp(body.code));
    setRotatedSessionCookie(reply, request, rotated.sessionToken);
  }

  @PartialSession()
  @Post('mfa/recovery')
  @HttpCode(204)
  async verifyRecovery(
    @Body(new ZodValidationPipe(recoveryCodeRequestSchema)) body: RecoveryCodeRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const rotated = unwrap(await this.secondFactor.verifyRecoveryCode(body.code));
    setRotatedSessionCookie(reply, request, rotated.sessionToken);
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
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TotpConfirmResponse> {
    const result = unwrap(await this.secondFactor.confirmTotpEnrollment(body.code));
    setRotatedSessionCookie(reply, request, result.sessionToken);
    return { recoveryCodes: result.recoveryCodes };
  }

  @Post('reauth')
  @HttpCode(204)
  async reauthenticate(
    @Body(new ZodValidationPipe(reauthRequestSchema)) body: ReauthRequest,
  ): Promise<void> {
    unwrap(await this.secondFactor.reauthenticate(body.code));
  }

  /** Paso 1 de la reautenticación con llave de acceso (sesión completa, ADR 0033). */
  @Post('reauth/passkey/options')
  @HttpCode(200)
  async reauthPasskeyOptions(): Promise<unknown> {
    return unwrap(await this.secondFactor.beginPasskeyReauthentication()).options;
  }

  @Post('reauth/passkey/verify')
  @HttpCode(204)
  async reauthPasskeyVerify(
    @Body(new ZodValidationPipe(reauthPasskeyRequestSchema)) body: ReauthPasskeyRequest,
  ): Promise<void> {
    unwrap(await this.secondFactor.reauthenticateWithPasskey(body.response));
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
    private readonly passkeys: Passkeys,
  ) {}

  @Get('passkeys')
  async listPasskeys(): Promise<{ data: Passkey[] }> {
    const rows = await this.passkeys.list();
    return {
      data: rows.map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt.toISOString(),
        lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      })),
    };
  }

  @Post('passkeys/registration/options')
  @HttpCode(200)
  async passkeyRegistrationOptions(): Promise<unknown> {
    return unwrap(await this.passkeys.beginRegistration()).options;
  }

  @Post('passkeys/registration/verify')
  async passkeyRegistrationVerify(
    @Body(new ZodValidationPipe(registerPasskeyRequestSchema)) body: RegisterPasskeyRequest,
  ): Promise<Passkey> {
    const created = unwrap(
      await this.passkeys.finishRegistration({ name: body.name, response: body.response }),
    );
    return {
      id: created.id,
      name: created.name,
      createdAt: created.createdAt.toISOString(),
      lastUsedAt: created.lastUsedAt?.toISOString() ?? null,
    };
  }

  @Post('passkeys/:id/revoke')
  @HttpCode(204)
  async revokePasskey(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<void> {
    unwrap(await this.passkeys.revoke(id));
  }

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
