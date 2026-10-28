import { createRoleRequestSchema, updateRoleRequestSchema } from '@iam/contracts';
import type { CreateRoleRequest, Role, UpdateRoleRequest } from '@iam/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Idempotent, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageRoles } from '../application/manage-roles.js';
import type { RoleRecord } from '../application/ports/role-repository.js';

const toRole = (role: RoleRecord): Role => ({
  id: role.id,
  name: role.name,
  isSystem: role.isSystem,
  permissions: [...role.permissions],
});

@Controller('roles')
export class RolesController {
  constructor(private readonly manageRoles: ManageRoles) {}

  @Get()
  async list(): Promise<{ data: Role[] }> {
    return { data: (await this.manageRoles.list()).map(toRole) };
  }

  @Idempotent()
  @Post()
  async create(
    @Body(new ZodValidationPipe(createRoleRequestSchema)) body: CreateRoleRequest,
  ): Promise<Role> {
    return toRole(unwrap(await this.manageRoles.create(body)));
  }

  @Idempotent()
  @Patch(':id')
  async update(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(updateRoleRequestSchema)) body: UpdateRoleRequest,
  ): Promise<Role> {
    return toRole(unwrap(await this.manageRoles.update(id, body)));
  }

  @Post(':id/archive')
  @HttpCode(204)
  async archive(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<void> {
    unwrap(await this.manageRoles.archive(id));
  }
}
