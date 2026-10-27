import { acceptInvitationRequestSchema, createInvitationRequestSchema } from '@iam/contracts';
import type {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CreateInvitationRequest,
  CreateInvitationResponse,
  InvitationPreviewResponse,
} from '@iam/contracts';
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Public, RateLimited, unwrap } from '../../../shared/http/http-decorators.js';
import { setSessionCookie } from './session-cookie.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import {
  AcceptInvitation,
  CreateInvitation,
  PreviewInvitation,
} from '../application/invitations.js';

const previewRequestSchema = z.object({ token: z.string().min(20).max(200) });

@RateLimited()
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly createInvitation: CreateInvitation,
    private readonly previewInvitation: PreviewInvitation,
    private readonly acceptInvitation: AcceptInvitation,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(createInvitationRequestSchema)) body: CreateInvitationRequest,
  ): Promise<CreateInvitationResponse> {
    const invitation = unwrap(
      await this.createInvitation.execute({
        email: body.email,
        rank: body.rank,
        roleIds: body.roleIds,
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
