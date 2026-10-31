import { setPersonRolesRequestSchema, setSpecialPermissionsRequestSchema } from '@iam/contracts';
import type {
  PermissionCatalogEntry,
  PersonRoles,
  Role,
  SetPersonRolesRequest,
  SetSpecialPermissionsRequest,
} from '@iam/contracts';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { asUserId } from '../../../shared/kernel/index.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManagePersonRoles } from '../application/manage-person-roles.js';
import type { PersonRolesView } from '../application/manage-person-roles.js';
import type { RoleRecord } from '../application/ports/role-repository.js';

const idSchema = z.uuid();

const toRole = (role: RoleRecord): Role => ({
  id: role.id,
  name: role.name,
  isSystem: role.isSystem,
  permissions: [...role.permissions],
});

const toPersonRoles = (view: PersonRolesView): PersonRoles => ({
  roles: view.roles.map(toRole),
  specialPermissions: [...view.specialPermissions],
});

/**
 * Catálogo de permisos y roles de una persona. Los cambios NO llevan `@Idempotent()`: la respuesta
 * guardada se reproduciría sin volver a autorizar ni exigir la reautenticación vigente. Reemplazar
 * por el mismo conjunto es inofensivo (no cambia nada ni audita).
 */
@Controller()
export class PersonRolesController {
  constructor(private readonly managePersonRoles: ManagePersonRoles) {}

  @Get('permissions')
  async catalog(): Promise<{ data: PermissionCatalogEntry[] }> {
    const entries = await this.managePersonRoles.catalog();
    return { data: entries.map((entry) => ({ ...entry })) };
  }

  @Get('users/:id/roles')
  async view(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<PersonRoles> {
    return toPersonRoles(await this.managePersonRoles.view(asUserId(id)));
  }

  @Post('users/:id/roles')
  @HttpCode(200)
  async setRoles(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(setPersonRolesRequestSchema)) body: SetPersonRolesRequest,
  ): Promise<PersonRoles> {
    return toPersonRoles(unwrap(await this.managePersonRoles.setRoles(asUserId(id), body.roleIds)));
  }

  @Post('users/:id/special-permissions')
  @HttpCode(200)
  async setSpecialPermissions(
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(setSpecialPermissionsRequestSchema))
    body: SetSpecialPermissionsRequest,
  ): Promise<PersonRoles> {
    return toPersonRoles(
      unwrap(await this.managePersonRoles.setSpecialPermissions(asUserId(id), body.permissions)),
    );
  }
}
