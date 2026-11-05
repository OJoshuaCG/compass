import { updateAlertSettingsRequestSchema } from '@iam/contracts';
import type { AlertSettings, UpdateAlertSettingsRequest } from '@iam/contracts';
import { Body, Controller, Get, Header, Put } from '@nestjs/common';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageAlertSettings } from '../application/manage-alert-settings.js';
import type { AlertSettingsRecord } from '../domain/alert-settings.js';

const toAlertSettings = (record: AlertSettingsRecord): AlertSettings => ({
  infrastructure: record.infrastructure,
  version: record.version,
  updatedAt: record.updatedAt === null ? null : record.updatedAt.toISOString(),
});

/** Panel de la Raíz: por qué canales recibe las alertas de infraestructura. Permiso y reautenticación en el caso de uso. */
@Controller('integrations/alert-settings')
export class AlertSettingsController {
  constructor(private readonly alertSettings: ManageAlertSettings) {}

  @Header('Cache-Control', 'no-store')
  @Get()
  async get(): Promise<AlertSettings> {
    return toAlertSettings(unwrap(await this.alertSettings.get()));
  }

  @Header('Cache-Control', 'no-store')
  @Put()
  async update(
    @Body(new ZodValidationPipe(updateAlertSettingsRequestSchema))
    body: UpdateAlertSettingsRequest,
  ): Promise<AlertSettings> {
    return toAlertSettings(unwrap(await this.alertSettings.update(body)));
  }
}
