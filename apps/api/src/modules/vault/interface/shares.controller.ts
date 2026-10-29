import { createShareRequestSchema } from '@iam/contracts';
import type { CreateShareRequest, Share } from '@iam/contracts';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { Idempotent, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageShares } from '../application/manage-shares.js';
import type { ShareView } from '../application/ports/share-repository.js';

const uuidPipe = new ZodValidationPipe(z.uuid());

const toShare = (share: ShareView): Share => ({
  id: share.id,
  accountId: share.accountId,
  granteeType: share.granteeType,
  granteeId: share.granteeId,
  granteeName: share.granteeName,
  level: share.level,
  expiresAt: share.expiresAt === null ? null : share.expiresAt.toISOString(),
  grantedBy: share.grantedBy,
  createdAt: share.createdAt.toISOString(),
});

@Controller('accounts/:accountId/shares')
export class AccountSharesController {
  constructor(private readonly manageShares: ManageShares) {}

  @Get()
  async list(@Param('accountId', uuidPipe) accountId: string): Promise<{ data: Share[] }> {
    const shares = unwrap(await this.manageShares.list(accountId));
    return { data: shares.map(toShare) };
  }

  @Idempotent()
  @Post()
  async share(
    @Param('accountId', uuidPipe) accountId: string,
    @Body(new ZodValidationPipe(createShareRequestSchema)) body: CreateShareRequest,
  ): Promise<Share> {
    return toShare(unwrap(await this.manageShares.share(accountId, body)));
  }

  @Post(':shareId/revoke')
  @HttpCode(204)
  async revoke(
    @Param('accountId', uuidPipe) accountId: string,
    @Param('shareId', uuidPipe) shareId: string,
  ): Promise<void> {
    unwrap(await this.manageShares.revoke(accountId, shareId));
  }
}
