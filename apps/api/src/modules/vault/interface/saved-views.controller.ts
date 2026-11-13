import { createSavedAccountViewRequestSchema } from '@iam/contracts';
import type { CreateSavedAccountViewRequest, SavedAccountView } from '@iam/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { Idempotent, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageSavedViews } from '../application/manage-saved-views.js';
import type { SavedViewRecord } from '../application/ports/saved-view-repository.js';

const toSavedView = (record: SavedViewRecord): SavedAccountView => ({
  id: record.id,
  name: record.name,
  q: record.searchText,
  filter: record.quickFilter,
  createdAt: record.createdAt.toISOString(),
});

@Controller('account-views')
export class SavedViewsController {
  constructor(private readonly manageSavedViews: ManageSavedViews) {}

  @Get()
  async list(): Promise<{ data: SavedAccountView[] }> {
    const views = await this.manageSavedViews.list();
    return { data: views.map(toSavedView) };
  }

  @Idempotent()
  @Post()
  async create(
    @Body(new ZodValidationPipe(createSavedAccountViewRequestSchema))
    body: CreateSavedAccountViewRequest,
  ): Promise<SavedAccountView> {
    const created = unwrap(
      await this.manageSavedViews.create({ name: body.name, text: body.q, filter: body.filter }),
    );
    return toSavedView(created);
  }

  @Idempotent()
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<void> {
    unwrap(await this.manageSavedViews.remove(id));
  }
}
