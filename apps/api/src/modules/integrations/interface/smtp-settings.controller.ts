import {
  createSmtpSettingsRequestSchema,
  rotateSmtpPasswordRequestSchema,
  updateSmtpSettingsRequestSchema,
} from '@iam/contracts';
import type {
  CreateSmtpSettingsRequest,
  RotateSmtpPasswordRequest,
  SmtpSettings,
  SmtpSettingsResponse,
  SmtpTestResult,
  UpdateSmtpSettingsRequest,
} from '@iam/contracts';
import { Body, Controller, Delete, Get, Header, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageSmtpSettings } from '../application/manage-smtp-settings.js';
import type { SmtpSettingsRecord } from '../application/ports/smtp-settings-store.js';

const uuidPipe = new ZodValidationPipe(z.uuid());

/** La contraseña nunca sale: solo se informa si hay una guardada. */
const toSettings = (record: SmtpSettingsRecord): SmtpSettings => ({
  id: record.id,
  name: record.name,
  status: record.status,
  host: record.host,
  port: record.port,
  security: record.security,
  username: record.username,
  fromAddress: record.fromAddress,
  hasPassword: record.hasPassword,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

/**
 * Sin `@Idempotent`: las peticiones llevan la contraseña SMTP y así ninguna caché intermedia retiene nada
 * de ellas. Todas las rutas piden el permiso `alerts.infra.manage` (Raíz) y reautenticación en el caso de uso.
 */
@Controller('integrations/smtp')
export class SmtpSettingsController {
  constructor(private readonly smtp: ManageSmtpSettings) {}

  @Header('Cache-Control', 'no-store')
  @Get()
  async list(): Promise<SmtpSettingsResponse> {
    return { data: unwrap(await this.smtp.list()).map(toSettings) };
  }

  @Header('Cache-Control', 'no-store')
  @Post()
  async create(
    @Body(new ZodValidationPipe(createSmtpSettingsRequestSchema))
    body: CreateSmtpSettingsRequest,
  ): Promise<SmtpSettings> {
    return toSettings(unwrap(await this.smtp.create(body)));
  }

  @Header('Cache-Control', 'no-store')
  @Put(':settingsId')
  async update(
    @Param('settingsId', uuidPipe) settingsId: string,
    @Body(new ZodValidationPipe(updateSmtpSettingsRequestSchema))
    body: UpdateSmtpSettingsRequest,
  ): Promise<SmtpSettings> {
    return toSettings(unwrap(await this.smtp.update(settingsId, body)));
  }

  @Header('Cache-Control', 'no-store')
  @Put(':settingsId/password')
  async rotatePassword(
    @Param('settingsId', uuidPipe) settingsId: string,
    @Body(new ZodValidationPipe(rotateSmtpPasswordRequestSchema))
    body: RotateSmtpPasswordRequest,
  ): Promise<SmtpSettings> {
    return toSettings(unwrap(await this.smtp.rotatePassword(settingsId, body.password)));
  }

  @Header('Cache-Control', 'no-store')
  @Post(':settingsId/test')
  async sendTest(@Param('settingsId', uuidPipe) settingsId: string): Promise<SmtpTestResult> {
    return { outcome: unwrap(await this.smtp.sendTest(settingsId)) };
  }

  @Header('Cache-Control', 'no-store')
  @Delete(':settingsId')
  async archive(@Param('settingsId', uuidPipe) settingsId: string): Promise<SmtpSettings> {
    return toSettings(unwrap(await this.smtp.archive(settingsId)));
  }
}
