import { revealInboundResetsRequestSchema } from '@iam/contracts';
import type { InboundResetsResponse, RevealInboundResetsRequest } from '@iam/contracts';
import { Body, Controller, Header, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { RevealInboundResets } from '../application/reveal-inbound-resets.js';

/** Los restablecimientos viajan solo en esta respuesta: ningún caché, ni del navegador ni de un intermediario, la guarda. */
const NO_STORE = 'no-store';

// Sin `@Idempotent()`: guardar la respuesta para repetirla guardaría los valores revelados.
@Controller('inbound/views/:viewId/resets')
export class InboundResetsController {
  constructor(private readonly revealInboundResets: RevealInboundResets) {}

  // Sin cuerpo obligatorio: uno ausente se trata como "sin motivo" y se niega con auditoría.
  @Header('Cache-Control', NO_STORE)
  @HttpCode(200)
  @Post('reveal')
  async reveal(
    @Param('viewId', new ZodValidationPipe(z.uuid())) viewId: string,
    @Body(
      new ZodValidationPipe(z.preprocess((body) => body ?? {}, revealInboundResetsRequestSchema)),
    )
    body: RevealInboundResetsRequest,
  ): Promise<InboundResetsResponse> {
    // Un motivo que no es texto cuenta como "sin motivo": el caso de uso lo niega y lo audita.
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    const revealed = unwrap(await this.revealInboundResets.reveal(viewId, reason));
    return {
      data: revealed.map((item) => ({
        itemId: item.itemId,
        kind: item.kind,
        valueType: item.valueType,
        value: item.value,
        expiresAt: item.expiresAt.toISOString(),
      })),
    };
  }
}
