import { proposeRootTransferRequestSchema } from '@iam/contracts';
import type { ProposeRootTransferRequest, RootTransfer } from '@iam/contracts';
import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { asUserId } from '../../../shared/kernel/index.js';
import { ManageRootTransfer } from '../application/manage-root-transfer.js';
import type { RootTransferView } from '../application/manage-root-transfer.js';

const toResponse = (view: RootTransferView): RootTransfer => {
  if (view.status !== 'pending_acceptance' && view.status !== 'waiting') {
    throw new Error('Only an open root transfer can be shown');
  }
  return {
    id: view.id,
    fromUserId: view.fromUserId,
    toUserId: view.toUserId,
    status: view.status,
    requestedAt: view.requestedAt.toISOString(),
    expiresAt: view.expiresAt.toISOString(),
    acceptedAt: view.acceptedAt?.toISOString() ?? null,
    executesAt: view.executesAt?.toISOString() ?? null,
  };
};

/**
 * Transferencia de la Raíz. Ninguna ruta es idempotente (`@Idempotent()`): una respuesta guardada se
 * reproduciría sin volver a autorizar ni exigir la reautenticación reciente.
 */
@Controller('root-transfer')
export class RootTransferController {
  constructor(private readonly manageRootTransfer: ManageRootTransfer) {}

  @Get()
  async current(): Promise<{ data: RootTransfer | null }> {
    const view = unwrap(await this.manageRootTransfer.current());
    return { data: view === null ? null : toResponse(view) };
  }

  @Post()
  async propose(
    @Body(new ZodValidationPipe(proposeRootTransferRequestSchema))
    body: ProposeRootTransferRequest,
  ): Promise<{ data: RootTransfer }> {
    const view = unwrap(await this.manageRootTransfer.propose(asUserId(body.targetUserId)));
    return { data: toResponse(view) };
  }

  @Post('accept')
  async accept(): Promise<{ data: RootTransfer }> {
    return { data: toResponse(unwrap(await this.manageRootTransfer.accept())) };
  }

  @Delete()
  @HttpCode(204)
  async cancel(): Promise<void> {
    unwrap(await this.manageRootTransfer.cancel());
  }
}
