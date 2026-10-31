import {
  acceptInvitationRequestSchema,
  createInvitationRequestSchema,
  fixedOrderPageQuerySchema,
} from '@iam/contracts';
import type {
  FixedOrderPageQuery,
  PendingInvitation,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CreateInvitationRequest,
  CreateInvitationResponse,
  CreateInvitationWithLinkResponse,
  InvitationPreviewResponse,
} from '@iam/contracts';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Idempotent, Public, RateLimited, unwrap } from '../../../shared/http/http-decorators.js';
import { setSessionCookie } from './session-cookie.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { asUserId } from '../../../shared/kernel/index.js';
import {
  AcceptInvitation,
  CreateInvitation,
  ListInvitations,
  PreviewInvitation,
  ResendInvitation,
} from '../application/invitations.js';

/** La respuesta lleva el enlace de una invitación: nada de cachés intermedias ni del navegador. */
const NO_STORE = 'no-store';

const previewRequestSchema = z.object({ token: z.string().min(20).max(200) });

@RateLimited()
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly createInvitation: CreateInvitation,
    private readonly previewInvitation: PreviewInvitation,
    private readonly acceptInvitation: AcceptInvitation,
    private readonly listInvitations: ListInvitations,
    private readonly resendInvitation: ResendInvitation,
  ) {}

  @Get()
  async pending(
    @Query(new ZodValidationPipe(fixedOrderPageQuerySchema)) query: FixedOrderPageQuery,
  ): Promise<{ data: PendingInvitation[]; page: { nextCursor: string | null; limit: number } }> {
    const page = await this.listInvitations.execute({
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return {
      data: page.rows.map((row) => ({
        id: row.id,
        email: row.email,
        rank: row.rank,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        expired: row.expired,
      })),
      page: { nextCursor: page.nextCursor, limit: query.limit },
    };
  }

  @Idempotent()
  @Post(':id/resend')
  async resend(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ): Promise<CreateInvitationResponse> {
    const invitation = unwrap(await this.resendInvitation.execute(id));
    return {
      id: invitation.id,
      email: invitation.email,
      rank: invitation.rank,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Reenvío que entrega el enlace a quien reenvía (`user.invite_link`, con reautenticación). SIN
   * `@Idempotent()`: el interceptor guardaría el cuerpo de la respuesta, es decir, el enlace en claro.
   * Reintentar no duplica: la invitación revocada ya no se puede reenviar.
   */
  @Post(':id/resend-with-link')
  @Header('Cache-Control', NO_STORE)
  async resendWithLink(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ): Promise<CreateInvitationWithLinkResponse> {
    const invitation = unwrap(await this.resendInvitation.executeWithLink(id));
    return {
      id: invitation.id,
      email: invitation.email,
      rank: invitation.rank,
      expiresAt: invitation.expiresAt.toISOString(),
      link: invitation.link,
      emailSent: invitation.emailSent,
    };
  }

  /** Igual que `POST /invitations`, pero entrega el enlace; sin `@Idempotent()` por la misma razón. */
  @Post('with-link')
  @Header('Cache-Control', NO_STORE)
  async createWithLink(
    @Body(new ZodValidationPipe(createInvitationRequestSchema)) body: CreateInvitationRequest,
  ): Promise<CreateInvitationWithLinkResponse> {
    const invitation = unwrap(
      await this.createInvitation.executeWithLink({
        email: body.email,
        rank: body.rank,
        roleIds: body.roleIds,
        ...(body.managerId === undefined ? {} : { managerId: asUserId(body.managerId) }),
      }),
    );
    return {
      id: invitation.id,
      email: invitation.email,
      rank: invitation.rank,
      expiresAt: invitation.expiresAt.toISOString(),
      link: invitation.link,
      emailSent: invitation.emailSent,
    };
  }

  @Idempotent()
  @Post()
  async create(
    @Body(new ZodValidationPipe(createInvitationRequestSchema)) body: CreateInvitationRequest,
  ): Promise<CreateInvitationResponse> {
    const invitation = unwrap(
      await this.createInvitation.execute({
        email: body.email,
        rank: body.rank,
        roleIds: body.roleIds,
        ...(body.managerId === undefined ? {} : { managerId: asUserId(body.managerId) }),
      }),
    );
    return {
      id: invitation.id,
      email: invitation.email,
      rank: invitation.rank,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /** POST (no GET) para que el token nunca aparezca en la URL ni en los registros de acceso. */
  @Public()
  @Post('preview')
  @HttpCode(200)
  async preview(
    @Body(new ZodValidationPipe(previewRequestSchema)) body: { token: string },
  ): Promise<InvitationPreviewResponse> {
    const found = unwrap(await this.previewInvitation.execute(body.token));
    return { email: found.email, rank: found.rank, expiresAt: found.expiresAt.toISOString() };
  }

  @Public()
  @Post('accept')
  @HttpCode(200)
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) body: AcceptInvitationRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AcceptInvitationResponse> {
    const session = unwrap(
      await this.acceptInvitation.execute({
        token: body.token,
        displayName: body.displayName,
        password: body.password,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        requestId: request.id,
      }),
    );
    setSessionCookie(reply, session.token, session.expiresAt);
    return { status: 'enrollment_required' };
  }
}
