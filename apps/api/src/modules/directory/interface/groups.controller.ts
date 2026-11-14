import {
  addGroupMemberRequestSchema,
  createGroupRequestSchema,
  listGroupsQuerySchema,
} from '@iam/contracts';
import type {
  AddGroupMemberRequest,
  CreateGroupRequest,
  Group,
  GroupMember,
  ListGroupsQuery,
} from '@iam/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { asUserId } from '../../../shared/kernel/index.js';
import { ManageGroups } from '../application/manage-groups.js';
import type { GroupView } from '../application/manage-groups.js';
import type { GroupMemberRow } from '../application/ports/group-store.js';

const uuidPipe = new ZodValidationPipe(z.uuid());

const toGroup = (view: GroupView): Group => ({
  id: view.id,
  name: view.name,
  description: view.description,
  memberCount: view.memberCount,
  myRole: view.roleOfViewer,
  canManageMembers: view.canManageMembers,
  createdAt: view.createdAt.toISOString(),
});

const toMember = (row: GroupMemberRow): GroupMember => ({
  userId: row.userId,
  displayName: row.displayName,
  role: row.role,
  addedAt: row.addedAt.toISOString(),
});

/** Grupos. Ninguna ruta es idempotente: cada una se autoriza de nuevo en cada llamada. */
@Controller('groups')
export class GroupsController {
  constructor(private readonly manageGroups: ManageGroups) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listGroupsQuerySchema)) query: ListGroupsQuery,
  ): Promise<{ data: Group[] }> {
    const views = await this.manageGroups.list({ managedByMe: query.managedByMe });
    return { data: views.map(toGroup) };
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createGroupRequestSchema)) body: CreateGroupRequest,
  ): Promise<{ data: { id: string } }> {
    const group = unwrap(await this.manageGroups.create(body));
    return { data: { id: group.id } };
  }

  @Get(':groupId/members')
  async members(@Param('groupId', uuidPipe) groupId: string): Promise<{ data: GroupMember[] }> {
    const rows = unwrap(await this.manageGroups.listMembers(groupId));
    return { data: rows.map(toMember) };
  }

  @Post(':groupId/members')
  async addMember(
    @Param('groupId', uuidPipe) groupId: string,
    @Body(new ZodValidationPipe(addGroupMemberRequestSchema)) body: AddGroupMemberRequest,
  ): Promise<{ data: GroupMember[] }> {
    const rows = unwrap(
      await this.manageGroups.addMember(groupId, asUserId(body.userId), body.role),
    );
    return { data: rows.map(toMember) };
  }

  @Delete(':groupId/members/:userId')
  @HttpCode(200)
  async removeMember(
    @Param('groupId', uuidPipe) groupId: string,
    @Param('userId', uuidPipe) userId: string,
  ): Promise<{ data: GroupMember[] }> {
    const rows = unwrap(await this.manageGroups.removeMember(groupId, asUserId(userId)));
    return { data: rows.map(toMember) };
  }
}
