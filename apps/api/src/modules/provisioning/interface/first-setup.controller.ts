import { firstSetupRequestSchema } from '@iam/contracts';
import type { FirstSetupRequest, FirstSetupResponse } from '@iam/contracts';
import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { Public, RateLimited, unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { FirstRootSetup } from '../application/first-root-setup.js';

/** La respuesta lleva los códigos de emergencia: nada de cachés intermedias ni del navegador. */
const NO_STORE = 'no-store';

/**
 * Configuración inicial (ADR 0046). Ruta pública y limitada por IP; la protege el token de
 * `FIRST_SETUP_TOKEN` y se cierra sola cuando existe la primera organización.
 * No usa `@Idempotent()`: guardar la respuesta repetiría los códigos de emergencia.
 */
@RateLimited()
@Controller('setup')
export class FirstSetupController {
  constructor(private readonly firstRootSetup: FirstRootSetup) {}

  @Public()
  @Post()
  @HttpCode(201)
  @Header('Cache-Control', NO_STORE)
  async setup(
    @Body(new ZodValidationPipe(firstSetupRequestSchema)) body: FirstSetupRequest,
    @Req() request: FastifyRequest,
  ): Promise<FirstSetupResponse> {
    const result = unwrap(await this.firstRootSetup.execute(body, request.ip));
    return {
      organizationId: result.organizationId,
      emergencyCodes: result.emergencyCodes.map(({ code, custodyGroup }) => ({
        code,
        custodyGroup,
      })),
    };
  }
}
