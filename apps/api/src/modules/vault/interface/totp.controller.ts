import {
  confirmTotpRequestSchema,
  exportTotpRequestSchema,
  registerTotpRequestSchema,
} from '@iam/contracts';
import type {
  ConfirmTotpRequest,
  CredentialTotp,
  ExportTotpRequest,
  ExportedTotp,
  RegisterTotpRequest,
  TotpCode,
} from '@iam/contracts';
import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageTotp } from '../application/manage-totp.js';
import type { TotpRecord } from '../application/ports/totp-repository.js';

/** Respuestas con secretos o códigos: ningún caché, ni del navegador ni de un intermediario, debe guardarlas. */
const NO_STORE = 'no-store';

const uuidPipe = new ZodValidationPipe(z.uuid());

const toCredentialTotp = (totp: TotpRecord): CredentialTotp => ({
  status: totp.status,
  algorithm: totp.algorithm,
  digits: totp.digits,
  periodSeconds: totp.periodSeconds,
  registeredAt: totp.registeredAt.toISOString(),
  verifiedAt: totp.verifiedAt === null ? null : totp.verifiedAt.toISOString(),
  exposed: totp.exposedAt !== null,
});

// Ninguna ruta lleva `@Idempotent()`: los cuerpos y las respuestas llevan secretos o códigos.
@Controller('credentials/:id/totp')
export class TotpController {
  constructor(private readonly manageTotp: ManageTotp) {}

  @Header('Cache-Control', NO_STORE)
  @Get()
  async status(@Param('id', uuidPipe) id: string): Promise<CredentialTotp> {
    return toCredentialTotp(unwrap(await this.manageTotp.status(id)));
  }

  @Header('Cache-Control', NO_STORE)
  @Post()
  async register(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(registerTotpRequestSchema)) body: RegisterTotpRequest,
  ): Promise<CredentialTotp> {
    return toCredentialTotp(unwrap(await this.manageTotp.register(id, body.otpauthUri)));
  }

  @Header('Cache-Control', NO_STORE)
  @HttpCode(200)
  @Post('confirm')
  async confirm(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(confirmTotpRequestSchema)) body: ConfirmTotpRequest,
  ): Promise<CredentialTotp> {
    return toCredentialTotp(unwrap(await this.manageTotp.confirm(id, body.code)));
  }

  @Header('Cache-Control', NO_STORE)
  @HttpCode(200)
  @Post('code')
  async code(@Param('id', uuidPipe) id: string): Promise<TotpCode> {
    return unwrap(await this.manageTotp.issueCode(id));
  }

  // Sin cuerpo obligatorio: uno ausente se trata como "sin motivo" y se niega con auditoría.
  @Header('Cache-Control', NO_STORE)
  @HttpCode(200)
  @Post('export')
  async export(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(z.preprocess((body) => body ?? {}, exportTotpRequestSchema)))
    body: ExportTotpRequest,
  ): Promise<ExportedTotp> {
    return unwrap(await this.manageTotp.exportSecret(id, body.reason));
  }

  @Header('Cache-Control', NO_STORE)
  @HttpCode(200)
  @Post('retire')
  async retire(@Param('id', uuidPipe) id: string): Promise<CredentialTotp> {
    return toCredentialTotp(unwrap(await this.manageTotp.retire(id)));
  }
}
