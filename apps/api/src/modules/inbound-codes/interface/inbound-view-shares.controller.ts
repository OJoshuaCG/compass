import { createShareRequestSchema } from '@iam/contracts';
import type { CreateShareRequest, InboundViewShare } from '@iam/contracts';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { Idempotent, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageInboundViewShares } from '../application/manage-inbound-view-shares.js';
import type { ViewShareView } from '../application/ports/inbound-view-share-repository.js';

const uuidPipe = new ZodValidationPipe(z.uuid());

const toShare = (share: ViewShareView): InboundViewShare => ({
  id: share.id,
  viewId: share.viewId,
  granteeType: share.granteeType,
  granteeId: share.granteeId,
  granteeName: share.granteeName,
  level: share.level,
  expiresAt: share.expiresAt === null ? null : share.expiresAt.toISOString(),
  grantedBy: share.grantedBy,
  createdAt: share.createdAt.toISOString(),
});

@Controller('inbound/views/:viewId/shares')
export class InboundViewSharesController {
  constructor(private readonly manageShares: ManageInboundViewShares) {}

  @Get()
  async list(@Param('viewId', uuidPipe) viewId: string): Promise<{ data: InboundViewShare[] }> {
    const shares = unwrap(await this.manageShares.list(viewId));
    return { data: shares.map(toShare) };
  }

  @Idempotent()
  @Post()
  async share(
    @Param('viewId', uuidPipe) viewId: string,
    @Body(new ZodValidationPipe(createShareRequestSchema)) body: CreateShareRequest,
  ): Promise<InboundViewShare> {
    return toShare(unwrap(await this.manageShares.share(viewId, body)));
  }

  @Post(':shareId/revoke')
  @HttpCode(204)
  async revoke(
    @Param('viewId', uuidPipe) viewId: string,
    @Param('shareId', uuidPipe) shareId: string,
  ): Promise<void> {
    unwrap(await this.manageShares.revoke(viewId, shareId));
  }
}
