import type { InboundSourcesResponse, InboundViewsResponse } from '@iam/contracts';
import { Controller, Get, Header } from '@nestjs/common';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ListInboundDirectory } from '../application/list-inbound-directory.js';

/** El listado describe a qué tiene acceso la persona: ningún caché compartido lo guarda. */
const NO_STORE = 'no-store';

@Controller('inbound')
export class InboundDirectoryController {
  constructor(private readonly directory: ListInboundDirectory) {}

  @Header('Cache-Control', NO_STORE)
  @Get('views')
  async views(): Promise<InboundViewsResponse> {
    const views = unwrap(await this.directory.listViews());
    return {
      data: views.map((view) => ({
        id: view.id,
        name: view.name,
        sourceId: view.sourceId,
        sourceDisplayName: view.sourceDisplayName,
        channel: view.channel,
        level: view.level,
      })),
    };
  }

  @Header('Cache-Control', NO_STORE)
  @Get('sources')
  async sources(): Promise<InboundSourcesResponse> {
    const sources = unwrap(await this.directory.listSources());
    return {
      data: sources.map((source) => ({
        id: source.id,
        channel: source.channel,
        address: source.address,
        displayName: source.displayName,
        accountId: source.accountId,
        status: source.status,
        createdAt: source.createdAt.toISOString(),
        level: source.level,
      })),
    };
  }
}
