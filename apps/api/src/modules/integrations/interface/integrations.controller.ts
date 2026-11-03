import {
  createTelegramIntegrationRequestSchema,
  rotateTelegramBotTokenRequestSchema,
  updateTelegramIntegrationRequestSchema,
} from '@iam/contracts';
import type {
  CreateTelegramIntegrationRequest,
  RotateTelegramBotTokenRequest,
  TelegramIntegration,
  TelegramIntegrationsResponse,
  TelegramTestResult,
  UpdateTelegramIntegrationRequest,
} from '@iam/contracts';
import { Body, Controller, Delete, Get, Header, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageTelegramIntegrations } from '../application/manage-telegram-integrations.js';
import type { IntegrationRecord } from '../application/ports/integration-repository.js';

const uuidPipe = new ZodValidationPipe(z.uuid());

/** El token nunca sale: solo se informa si hay uno guardado. */
const toIntegration = (record: IntegrationRecord): TelegramIntegration => ({
  id: record.id,
  kind: record.kind,
  name: record.name,
  status: record.status,
  chatId: record.chatId,
  hasBotToken: record.hasBotToken,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

/**
 * Sin `@Idempotent`: las peticiones llevan el token del bot y así ninguna caché intermedia retiene nada
 * de ellas. Cada ruta pide el permiso de su canal y reautenticación en el caso de uso.
 */
@Controller('integrations/telegram')
export class IntegrationsController {
  constructor(private readonly integrations: ManageTelegramIntegrations) {}

  @Header('Cache-Control', 'no-store')
  @Get()
  async list(): Promise<TelegramIntegrationsResponse> {
    const records = unwrap(await this.integrations.list());
    return { data: records.map(toIntegration) };
  }

  @Header('Cache-Control', 'no-store')
  @Post()
  async create(
    @Body(new ZodValidationPipe(createTelegramIntegrationRequestSchema))
    body: CreateTelegramIntegrationRequest,
  ): Promise<TelegramIntegration> {
    return toIntegration(unwrap(await this.integrations.create(body)));
  }

  @Header('Cache-Control', 'no-store')
  @Put(':integrationId')
  async update(
    @Param('integrationId', uuidPipe) integrationId: string,
    @Body(new ZodValidationPipe(updateTelegramIntegrationRequestSchema))
    body: UpdateTelegramIntegrationRequest,
  ): Promise<TelegramIntegration> {
    return toIntegration(unwrap(await this.integrations.update(integrationId, body)));
  }

  @Header('Cache-Control', 'no-store')
  @Put(':integrationId/bot-token')
  async rotateBotToken(
    @Param('integrationId', uuidPipe) integrationId: string,
    @Body(new ZodValidationPipe(rotateTelegramBotTokenRequestSchema))
    body: RotateTelegramBotTokenRequest,
  ): Promise<TelegramIntegration> {
    return toIntegration(
      unwrap(await this.integrations.rotateBotToken(integrationId, body.botToken)),
    );
  }

  @Header('Cache-Control', 'no-store')
  @Post(':integrationId/test')
  async sendTest(
    @Param('integrationId', uuidPipe) integrationId: string,
  ): Promise<TelegramTestResult> {
    return { outcome: unwrap(await this.integrations.sendTest(integrationId)) };
  }

  @Header('Cache-Control', 'no-store')
  @Delete(':integrationId')
  async archive(
    @Param('integrationId', uuidPipe) integrationId: string,
  ): Promise<TelegramIntegration> {
    return toIntegration(unwrap(await this.integrations.archive(integrationId)));
  }
}
