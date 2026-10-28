import { rotateDataKeyRequestSchema } from '@iam/contracts';
import type { DataKeyRotation, RotateDataKeyRequest } from '@iam/contracts';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { Idempotent, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { RotateDataKey } from '../application/rotate-data-key.js';

@Controller('organization/data-key')
export class DataKeyController {
  constructor(private readonly rotateDataKey: RotateDataKey) {}

  /** La guarda del controlador no autoriza: lo decide el motor de autorización dentro del caso de uso. */
  @Idempotent()
  @Post('rotate')
  @HttpCode(200)
  async rotate(
    @Body(new ZodValidationPipe(rotateDataKeyRequestSchema)) body: RotateDataKeyRequest,
  ): Promise<DataKeyRotation> {
    return unwrap(await this.rotateDataKey.execute(body));
  }
}
