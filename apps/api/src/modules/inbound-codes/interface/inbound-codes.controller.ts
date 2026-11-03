import { fixedOrderPageQuerySchema } from '@iam/contracts';
import type {
  FixedOrderPageQuery,
  InboundCodesResponse,
  InboundHistoryResponse,
} from '@iam/contracts';
import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ReadInboundCodes } from '../application/read-inbound-codes.js';

/** Los códigos viajan solo en esta respuesta: ningún caché, ni del navegador ni de un intermediario, la guarda. */
const NO_STORE = 'no-store';

const uuidPipe = new ZodValidationPipe(z.uuid());

// Ninguna ruta lleva `@Idempotent()`: la respuesta lleva códigos de acceso.
@Controller('inbound/views/:viewId')
export class InboundCodesController {
  constructor(private readonly readInboundCodes: ReadInboundCodes) {}

  @Header('Cache-Control', NO_STORE)
  @Get('codes')
  async codes(@Param('viewId', uuidPipe) viewId: string): Promise<InboundCodesResponse> {
    const delivered = unwrap(await this.readInboundCodes.listCodes(viewId));
    return {
      data: delivered.map((item) => ({
        itemId: item.itemId,
        code: item.code,
        expiresAt: item.expiresAt.toISOString(),
      })),
    };
  }

  @Header('Cache-Control', NO_STORE)
  @Get('history')
  async history(
    @Param('viewId', uuidPipe) viewId: string,
    @Query(new ZodValidationPipe(fixedOrderPageQuerySchema)) query: FixedOrderPageQuery,
  ): Promise<InboundHistoryResponse> {
    const page = unwrap(
      await this.readInboundCodes.history(viewId, {
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      }),
    );
    return {
      data: page.entries.map((entry) => ({
        id: entry.receiptId,
        receivedAt: entry.receivedAt.toISOString(),
        signingDomain: entry.signingDomain,
        templateKind: entry.templateKind,
      })),
      page: { nextCursor: page.nextCursor, limit: query.limit },
    };
  }
}
