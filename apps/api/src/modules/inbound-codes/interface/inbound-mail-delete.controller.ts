import { inboundMailDeleteStatusResponseSchema } from '@iam/contracts';
import type { InboundMailDeleteRequested, InboundMailDeleteStatusResponse } from '@iam/contracts';
import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { Idempotent, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { RequestInboundMailDelete } from '../application/request-inbound-mail-delete.js';

const ACCEPTED_STATUS = 202;

@Controller('inbound/receipts/:receiptId/mail-delete')
export class InboundMailDeleteController {
  constructor(private readonly requestInboundMailDelete: RequestInboundMailDelete) {}

  /**
   * Registra la petición; la ejecuta el worker en su siguiente pasada, por eso 202 y no 200. La respuesta no
   * lleva ningún dato del correo, así que `@Idempotent()` puede repetirla sin riesgo.
   */
  @Idempotent()
  @HttpCode(ACCEPTED_STATUS)
  @Post()
  async request(
    @Param('receiptId', new ZodValidationPipe(z.uuid())) receiptId: string,
  ): Promise<InboundMailDeleteRequested> {
    const requested = unwrap(await this.requestInboundMailDelete.request(receiptId));
    return { status: 'pending', alreadyPending: requested.alreadyPending };
  }

  @Get()
  async status(
    @Param('receiptId', new ZodValidationPipe(z.uuid())) receiptId: string,
  ): Promise<InboundMailDeleteStatusResponse> {
    const latest = unwrap(await this.requestInboundMailDelete.status(receiptId));
    if (latest === null) return { data: null };
    // El esquema valida el código de resultado: un valor fuera del catálogo es un defecto, no algo que mostrar.
    return inboundMailDeleteStatusResponseSchema.parse({
      data: {
        status: latest.status,
        resultCode: latest.resultCode,
        requestedAt: latest.requestedAt.toISOString(),
        completedAt: latest.completedAt === null ? null : latest.completedAt.toISOString(),
      },
    });
  }
}
