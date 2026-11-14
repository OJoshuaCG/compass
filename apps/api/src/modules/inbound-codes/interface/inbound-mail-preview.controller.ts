import {
  INBOUND_MAIL_PREVIEW_FAILURE_CODES,
  INBOUND_MAIL_PREVIEW_KINDS,
  inboundMailPreviewRequestSchema,
} from '@iam/contracts';
import type {
  InboundMailPreviewContentResponse,
  InboundMailPreviewRequested,
  InboundMailPreviewStatusResponse,
} from '@iam/contracts';
import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { Idempotent, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { PreviewInboundMail } from '../application/preview-inbound-mail.js';

const ACCEPTED_STATUS = 202;
const OK_STATUS = 200;
const NO_STORE = 'no-store';

const kindPipe = new ZodValidationPipe(z.enum(INBOUND_MAIL_PREVIEW_KINDS));
const bodyPipe = new ZodValidationPipe(
  z.preprocess((body) => body ?? {}, inboundMailPreviewRequestSchema),
);

const asReason = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

@Controller('inbound/receipts/:receiptId/mail-preview/:kind')
export class InboundMailPreviewController {
  constructor(private readonly previewInboundMail: PreviewInboundMail) {}

  /**
   * Registra la petición; la atiende el worker en su siguiente pasada, por eso 202. La respuesta no lleva nada del
   * correo, así que `@Idempotent()` puede repetirla sin riesgo.
   */
  @Idempotent()
  @HttpCode(ACCEPTED_STATUS)
  @Post()
  async request(
    @Param('receiptId', new ZodValidationPipe(z.uuid())) receiptId: string,
    @Param('kind', kindPipe) kind: (typeof INBOUND_MAIL_PREVIEW_KINDS)[number],
    @Body(bodyPipe) body: z.infer<typeof inboundMailPreviewRequestSchema>,
  ): Promise<InboundMailPreviewRequested> {
    const requested = unwrap(
      await this.previewInboundMail.request(receiptId, kind, asReason(body.reason)),
    );
    return { status: 'pending', alreadyPending: requested.alreadyPending };
  }

  @Header('Cache-Control', NO_STORE)
  @Get()
  async status(
    @Param('receiptId', new ZodValidationPipe(z.uuid())) receiptId: string,
    @Param('kind', kindPipe) kind: (typeof INBOUND_MAIL_PREVIEW_KINDS)[number],
  ): Promise<InboundMailPreviewStatusResponse> {
    const latest = unwrap(await this.previewInboundMail.status(receiptId, kind));
    if (latest === null) return { data: null };
    return {
      data: {
        status: latest.status,
        // Un código fuera del catálogo es un defecto, no algo que mostrar.
        resultCode:
          latest.resultCode === null || latest.resultCode === 'READY'
            ? null
            : z.enum(INBOUND_MAIL_PREVIEW_FAILURE_CODES).parse(latest.resultCode),
        requestedAt: latest.requestedAt.toISOString(),
      },
    };
  }

  /**
   * Entrega el contenido UNA sola vez y borra la fila. Es POST porque cambia estado y no debe cachearse ni
   * repetirse: sin `@Idempotent()` (repetirlo no puede devolver el mismo texto) y con `no-store`.
   */
  @Header('Cache-Control', NO_STORE)
  @HttpCode(OK_STATUS)
  @Post('read')
  async read(
    @Param('receiptId', new ZodValidationPipe(z.uuid())) receiptId: string,
    @Param('kind', kindPipe) kind: (typeof INBOUND_MAIL_PREVIEW_KINDS)[number],
    @Body(bodyPipe) body: z.infer<typeof inboundMailPreviewRequestSchema>,
  ): Promise<InboundMailPreviewContentResponse> {
    const content = unwrap(
      await this.previewInboundMail.read(receiptId, kind, asReason(body.reason)),
    );
    return { data: { kind, content } };
  }
}
