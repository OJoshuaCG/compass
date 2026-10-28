import {
  createAccountRequestSchema,
  fixedOrderPageQuerySchema,
  updateAccountRequestSchema,
} from '@iam/contracts';
import type {
  Account,
  CreateAccountRequest,
  FixedOrderPageQuery,
  Platform,
  UpdateAccountRequest,
} from '@iam/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { Idempotent, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageAccounts } from '../application/manage-accounts.js';
import type { AccountView, PlatformRecord } from '../application/ports/account-repository.js';

const toAccount = (account: AccountView): Account => ({
  id: account.id,
  platformId: account.platformId,
  displayName: account.displayName,
  handle: account.handle,
  ownerGroupId: account.ownerGroupId,
  tags: [...account.tags],
  status: account.status,
  myLevel: account.myLevel,
  createdAt: account.createdAt.toISOString(),
});

const toPlatform = (platform: PlatformRecord): Platform => ({ ...platform });

type AccountPage = { data: Account[]; page: { nextCursor: string | null; limit: number } };

const toAccountPage = (
  page: { readonly rows: readonly AccountView[]; readonly nextCursor: string | null },
  limit: number,
): AccountPage => ({
  data: page.rows.map(toAccount),
  page: { nextCursor: page.nextCursor, limit },
});

@Controller('platforms')
export class PlatformsController {
  constructor(private readonly manageAccounts: ManageAccounts) {}

  @Get()
  async list(): Promise<{ data: Platform[] }> {
    const platforms = await this.manageAccounts.listPlatforms();
    return { data: platforms.map(toPlatform) };
  }
}

@Controller('accounts')
export class AccountsController {
  constructor(private readonly manageAccounts: ManageAccounts) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(fixedOrderPageQuerySchema)) query: FixedOrderPageQuery,
  ): Promise<AccountPage> {
    const page = await this.manageAccounts.listMine({
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return toAccountPage(page, query.limit);
  }

  // Declarado antes de `:id` para que "inventory" no se lea como un identificador.
  @Get('inventory')
  async inventory(
    @Query(new ZodValidationPipe(fixedOrderPageQuerySchema)) query: FixedOrderPageQuery,
  ): Promise<AccountPage> {
    const page = await this.manageAccounts.listInventory({
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return toAccountPage(page, query.limit);
  }

  @Get(':id')
  async get(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<Account> {
    return toAccount(unwrap(await this.manageAccounts.get(id)));
  }

  @Idempotent()
  @Post()
  async create(
    @Body(new ZodValidationPipe(createAccountRequestSchema)) body: CreateAccountRequest,
  ): Promise<Account> {
    return toAccount(unwrap(await this.manageAccounts.create(body)));
  }

  @Idempotent()
  @Patch(':id')
  async update(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(updateAccountRequestSchema)) body: UpdateAccountRequest,
  ): Promise<Account> {
    return toAccount(unwrap(await this.manageAccounts.update(id, body)));
  }

  @Post(':id/archive')
  @HttpCode(204)
  async archive(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<void> {
    unwrap(await this.manageAccounts.archive(id));
  }
}
