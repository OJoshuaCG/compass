import { DIRECTORY_SORT_FIELDS, pageQuerySchema, safeText } from '@iam/contracts';
import type { DirectoryUser } from '@iam/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ListDirectory } from '../application/list-directory.js';

const directoryQuerySchema = pageQuerySchema.extend({
  sort: z.enum(DIRECTORY_SORT_FIELDS).optional(),
  q: safeText({ max: 100 }).optional(),
});

interface DirectoryPageResponse {
  data: DirectoryUser[];
  page: { nextCursor: string | null; limit: number };
}

@Controller('users')
export class UsersController {
  constructor(private readonly listDirectory: ListDirectory) {}

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
