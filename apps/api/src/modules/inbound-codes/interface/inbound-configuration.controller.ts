import {
  createInboundSourceRequestSchema,
  createInboundViewRequestSchema,
  updateInboundSourceRequestSchema,
  updateInboundViewRequestSchema,
} from '@iam/contracts';
import type {
  CreateInboundSourceRequest,
  CreateInboundViewRequest,
  InboundSource,
  InboundView,
  UpdateInboundSourceRequest,
  UpdateInboundViewRequest,
} from '@iam/contracts';
import { Body, Controller, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Idempotent, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageInboundConfiguration } from '../application/manage-inbound-configuration.js';
import type {
  SourceRecord,
  ViewRecord,
} from '../application/ports/inbound-configuration-repository.js';

const uuidPipe = new ZodValidationPipe(z.uuid());

const toSource = (source: SourceRecord): InboundSource => ({
  id: source.id,
  channel: source.channel,
  address: source.address,
  displayName: source.displayName,
  accountId: source.accountId,
  status: source.status,
  createdAt: source.createdAt.toISOString(),
});

const toView = (view: ViewRecord): InboundView => ({
  id: view.id,
  sourceId: view.sourceId,
  name: view.name,
  templateIds: [...view.templateIds],
  createdAt: view.createdAt.toISOString(),
});

@Controller('inbound')
export class InboundConfigurationController {
  constructor(private readonly configuration: ManageInboundConfiguration) {}

  @Idempotent()
  @Post('sources')
  async createSource(
    @Body(new ZodValidationPipe(createInboundSourceRequestSchema))
    body: CreateInboundSourceRequest,
  ): Promise<InboundSource> {
    return toSource(unwrap(await this.configuration.createSource(body)));
  }

  @Patch('sources/:sourceId')
  async updateSource(
    @Param('sourceId', uuidPipe) sourceId: string,
    @Body(new ZodValidationPipe(updateInboundSourceRequestSchema))
    body: UpdateInboundSourceRequest,
  ): Promise<InboundSource> {
    return toSource(unwrap(await this.configuration.updateSource(sourceId, body)));
  }

  @Post('sources/:sourceId/archive')
  @HttpCode(204)
  async archiveSource(@Param('sourceId', uuidPipe) sourceId: string): Promise<void> {
    unwrap(await this.configuration.archiveSource(sourceId));
  }

  @Idempotent()
  @Post('views')
  async createView(
    @Body(new ZodValidationPipe(createInboundViewRequestSchema)) body: CreateInboundViewRequest,
  ): Promise<InboundView> {
    return toView(unwrap(await this.configuration.createView(body)));
  }

  @Patch('views/:viewId')
  async updateView(
    @Param('viewId', uuidPipe) viewId: string,
    @Body(new ZodValidationPipe(updateInboundViewRequestSchema)) body: UpdateInboundViewRequest,
  ): Promise<InboundView> {
    return toView(unwrap(await this.configuration.updateView(viewId, body)));
  }

  @Post('views/:viewId/archive')
  @HttpCode(204)
  async archiveView(@Param('viewId', uuidPipe) viewId: string): Promise<void> {
    unwrap(await this.configuration.archiveView(viewId));
  }
}
