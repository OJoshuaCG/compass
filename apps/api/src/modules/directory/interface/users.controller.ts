import {
  DIRECTORY_SORT_FIELDS,
  changeRankRequestSchema,
  pageQuerySchema,
  safeText,
  transferManagerRequestSchema,
} from '@iam/contracts';
import type {
  ChangeRankRequest,
  DirectoryUser,
  ManagedUser,
  RankChangeResponse,
  TransferManagerRequest,
} from '@iam/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { asUserId } from '../../../shared/kernel/index.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ListDirectory } from '../application/list-directory.js';
import { ListManaged } from '../application/list-managed.js';
import { ManageUsers } from '../application/manage-users.js';

const directoryQuerySchema = pageQuerySchema.extend({
  sort: z.enum(DIRECTORY_SORT_FIELDS).optional(),
  q: safeText({ max: 100 }).optional(),
});

const idSchema = z.uuid();

interface DirectoryPageResponse {
  data: DirectoryUser[];
  page: { nextCursor: string | null; limit: number };
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly listDirectory: ListDirectory,
    private readonly listManaged: ListManaged,
    private readonly manageUsers: ManageUsers,
  ) {}

  /** Antes de `:id` para que `managed` no se interprete como un identificador. */
  @Get('managed')
  async managed(
    @Query(new ZodValidationPipe(directoryQuerySchema)) query: z.infer<typeof directoryQuerySchema>,
  ): Promise<{ data: ManagedUser[]; page: { nextCursor: string | null; limit: number } }> {
    const page = await this.listManaged.execute({
      limit: query.limit,
      search: query.q,
      sort: query.sort,
      dir: query.dir,
      cursor: query.cursor,
    });
    return {
      data: page.rows.map((row) => ({ ...row })),
      page: { nextCursor: page.nextCursor, limit: query.limit },
    };
  }

  @Post(':id/suspend')
  @HttpCode(204)
  async suspend(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<void> {
    unwrap(await this.manageUsers.suspend(asUserId(id)));
  }

  @Post(':id/reactivate')
  @HttpCode(204)
  async reactivate(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<void> {
    unwrap(await this.manageUsers.reactivate(asUserId(id)));
  }

  @Post(':id/deactivate')
  @HttpCode(204)
  async deactivate(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<void> {
    unwrap(await this.manageUsers.deactivate(asUserId(id)));
  }

  @Post(':id/sessions/revoke')
  @HttpCode(204)
  async revokeSessions(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<void> {
    unwrap(await this.manageUsers.revokeSessions(asUserId(id)));
  }

  /**
   * Responde 200 con el resultado (roles quitados, plantilla asignada o saltada y comparticiones
   * vivas, estas últimas solo con detalle si quien actúa tiene permiso sobre la bóveda). NO lleva
   * `@Idempotent()`: la respuesta guardada 24 horas se reproduciría sin volver a autorizar y
   * devolvería el detalle de comparticiones a quien ya perdió el permiso. Una repetición recibe
   * `USER.INVALID_STATE` (mismo rango); lo que se quitó queda en la auditoría. La respuesta solo
   * contiene ids, nombres de rol y niveles, ningún secreto.
   */
  @Post(':id/rank')
  @HttpCode(200)
  async changeRank(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(changeRankRequestSchema)) body: ChangeRankRequest,
  ): Promise<RankChangeResponse> {
    const outcome = unwrap(await this.manageUsers.changeRank(asUserId(id), body.rank, body.reason));
    return {
      removedRoles: outcome.removedRoles.map((role) => ({ id: role.id, name: role.name })),
      assignedRole:
        outcome.assignedRole === null
          ? null
          : { id: outcome.assignedRole.id, name: outcome.assignedRole.name },
      templateSkipped: outcome.templateSkipped,
      sharedAccounts: outcome.sharedAccounts.map((share) => ({
        shareId: share.shareId,
        accountId: share.accountId,
        granteeType: share.granteeType,
        granteeId: share.granteeId,
        level: share.level,
        expiresAt: share.expiresAt === null ? null : share.expiresAt.toISOString(),
      })),
      sharedAccountCount: outcome.sharedAccountCount,
    };
  }

  @Post(':id/manager')
  @HttpCode(204)
  async transferManager(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(transferManagerRequestSchema)) body: TransferManagerRequest,
  ): Promise<void> {
    unwrap(await this.manageUsers.transferManager(asUserId(id), asUserId(body.managerId)));
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(directoryQuerySchema)) query: z.infer<typeof directoryQuerySchema>,
  ): Promise<DirectoryPageResponse> {
    const page = await this.listDirectory.execute({
      limit: query.limit,
      search: query.q,
      sort: query.sort,
      dir: query.dir,
      cursor: query.cursor,
    });
    return {
      data: page.rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        email: row.email,
        rank: row.rank,
      })),
      page: { nextCursor: page.nextCursor, limit: query.limit },
    };
  }
}
