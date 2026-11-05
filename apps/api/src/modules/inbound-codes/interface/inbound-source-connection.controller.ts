import { putInboundSourceConnectionRequestSchema } from '@iam/contracts';
import type { InboundSourceConnection, PutInboundSourceConnectionRequest } from '@iam/contracts';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageInboundSourceConnection } from '../application/manage-inbound-source-connection.js';
import type { SourceConnectionRecord } from '../application/ports/inbound-source-connection-repository.js';

const uuidPipe = new ZodValidationPipe(z.uuid());

/** La contraseña nunca sale: solo se informa si hay una guardada. */
const toConnection = (connection: SourceConnectionRecord): InboundSourceConnection => ({
  sourceId: connection.sourceId,
  host: connection.host,
  port: connection.port,
  tlsMode: connection.tlsMode,
  username: connection.username,
  authservId: connection.authservId,
  acceptedRecipients: [...connection.acceptedRecipients],
  hasPassword: connection.hasPassword,
  updatedAt: connection.updatedAt.toISOString(),
});

/**
 * Sin `@Idempotent`: PUT ya es idempotente y así ninguna caché intermedia retiene nada de una petición que
 * puede llevar la contraseña de la casilla.
 */
@Controller('inbound/sources/:sourceId/connection')
export class InboundSourceConnectionController {
  constructor(private readonly connections: ManageInboundSourceConnection) {}

  @Get()
  async get(
    @Param('sourceId', uuidPipe) sourceId: string,
  ): Promise<{ connection: InboundSourceConnection | null }> {
    const connection = unwrap(await this.connections.get(sourceId));
    return { connection: connection === null ? null : toConnection(connection) };
  }

  @Put()
  async put(
    @Param('sourceId', uuidPipe) sourceId: string,
    @Body(new ZodValidationPipe(putInboundSourceConnectionRequestSchema))
    body: PutInboundSourceConnectionRequest,
  ): Promise<InboundSourceConnection> {
    return toConnection(unwrap(await this.connections.put(sourceId, body)));
  }
}
