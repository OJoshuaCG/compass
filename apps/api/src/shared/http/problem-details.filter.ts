import { ErrorCode } from '@iam/contracts';
import type { ProblemDetails } from '@iam/contracts';
import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { DomainError } from '../kernel/index.js';
import { externalCode, statusFor } from './problem-status.js';
import { RequestValidationError } from './request-validation-error.js';

const TITLE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'Bad request',
  401: 'Authentication required',
  403: 'Not allowed',
  404: 'Resource not found',
  405: 'Method not allowed',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Validation failed',
  429: 'Too many requests',
  503: 'Service temporarily unavailable',
};

const typeFor = (code: ErrorCode): string =>
  `https://errors.internal/${code.toLowerCase().replaceAll('.', '/')}`;

/**
 * Traduce cualquier excepción a Problem Details (RFC 9457). Nunca expone SQL, rutas, trazas ni
 * mensajes internos: solo un `code` estable y el `requestId` para que soporte rastree el caso.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const problem = this.toProblem(exception, request.id);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: request.id }, 'request failed');
    }
    if (exception instanceof DomainError && exception.code === ErrorCode.RATE_LIMITED) {
      const seconds = exception.meta['retryAfterSeconds'];
      if (typeof seconds === 'number') void reply.header('retry-after', String(seconds));
    }
    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .send(problem);
  }

  private toProblem(exception: unknown, requestId: string): ProblemDetails {
    if (exception instanceof RequestValidationError) {
      return this.build(ErrorCode.VALIDATION_FAILED, 422, requestId, [...exception.errors]);
    }
    if (exception instanceof DomainError) {
      const status = statusFor(exception.code);
      return this.build(externalCode(exception.code, status), status, requestId);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return this.build(this.codeForHttpStatus(status), status, requestId);
    }
    return this.build(ErrorCode.INTERNAL, 500, requestId);
  }

  private codeForHttpStatus(status: number): ErrorCode {
    if (status === 401) return ErrorCode.AUTHZ_SESSION;
    if (status === 403) return ErrorCode.AUTHZ_PERMISSION;
    if (status === 404) return ErrorCode.NOT_FOUND;
    if (status === 409) return ErrorCode.CONFLICT_VERSION;
    if (status === 429) return ErrorCode.RATE_LIMITED;
    if (status >= 400 && status < 500) return ErrorCode.VALIDATION_FAILED;
    return ErrorCode.INTERNAL;
  }

  private build(
    code: ErrorCode,
    status: number,
    requestId: string,
    errors?: ProblemDetails['errors'],
  ): ProblemDetails {
    return {
      type: typeFor(code),
      title:
        TITLE_BY_STATUS[status] ?? (status < 500 ? 'Request rejected' : 'Internal server error'),
      status,
      code,
      requestId,
      ...(errors === undefined ? {} : { errors }),
    };
  }
}
