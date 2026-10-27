import { ErrorCode, problemDetailsSchema } from '@iam/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MethodNotAllowedException,
  Post,
} from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLogger } from '../infrastructure/logger.js';
import { DomainError } from '../kernel/index.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const bodySchema = z.object({ email: z.email(), age: z.number().int().min(18) });

@Controller('probe')
class ProbeController {
  @Get('hierarchy')
  hierarchy(): never {
    throw new DomainError(ErrorCode.AUTHZ_HIERARCHY_NOT_IN_SUBTREE, 'internal detail: subtree X');
  }

  @Get('tenant')
  tenant(): never {
    throw new DomainError(ErrorCode.AUTHZ_TENANT, 'resource belongs to org B');
  }

  @Get('kms')
  kms(): never {
    throw new DomainError(
      ErrorCode.CRYPTO_KMS_UNAVAILABLE,
      'kms down',
      {},
      { cause: new Error('aws-secret') },
    );
  }

  @Get('decrypt')
  decrypt(): never {
    throw new DomainError(ErrorCode.CRYPTO_DECRYPT_FAILED, 'bad tag');
  }

  @Get('bad')
  bad(): never {
    throw new BadRequestException('internal parser detail');
  }

  @Get('method')
  method(): never {
    throw new MethodNotAllowedException();
  }

  @Get('boom')
  boom(): never {
    throw new Error('SELECT * FROM secrets -- internal stack detail');
  }

  @Post('validate')
  validate(@Body(new ZodValidationPipe(bodySchema)) body: z.infer<typeof bodySchema>): unknown {
    return body;
  }
}

let app: NestFastifyApplication;
const lines: string[] = [];

beforeAll(async () => {
  const module = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ genReqId: () => 'req-fixed-1', requestIdHeader: false }),
  );
  const logger = createLogger({
    level: 'error',
    destination: { write: (l) => void lines.push(l) },
  });
  app.useGlobalFilters(new ProblemDetailsFilter(logger));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('ProblemDetailsFilter', () => {
  it('maps a DomainError to a catalog code with the right status and a valid body', async () => {
    const res = await get('/probe/hierarchy');
    const body = problemDetailsSchema.parse(res.json());

    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(body.code).toBe('AUTHZ.HIERARCHY.NOT_IN_SUBTREE');
    expect(body.requestId).toBe('req-fixed-1');
    expect(res.body).not.toContain('subtree X');
  });

  it('answers a cross-organization resource as 404 NOT_FOUND (does not reveal it exists)', async () => {
    const res = await get('/probe/tenant');

    expect(res.statusCode).toBe(404);
    expect(res.json<{ code: string }>().code).toBe('NOT_FOUND');
    expect(res.body).not.toContain('org B');
  });

  it('exposes a KMS outage as 503 without the underlying cause', async () => {
    const res = await get('/probe/kms');

    expect(res.statusCode).toBe(503);
    expect(res.json<{ code: string }>().code).toBe('CRYPTO.KMS_UNAVAILABLE');
    expect(res.body).not.toContain('aws-secret');
  });

  it('hides internal 5xx codes behind INTERNAL', async () => {
    const res = await get('/probe/decrypt');

    expect(res.statusCode).toBe(500);
    expect(res.json<{ code: string }>().code).toBe('INTERNAL');
  });

  it('answers an unexpected error as a generic 500 and never leaks its message', async () => {
    const res = await get('/probe/boom');

    expect(res.statusCode).toBe(500);
    expect(res.json<{ code: string }>().code).toBe('INTERNAL');
    expect(res.body).not.toContain('SELECT');
    expect(res.body).not.toContain('stack');
  });

  it('logs unexpected failures server-side for diagnosis', async () => {
    await get('/probe/boom');
    expect(lines.join('')).toContain('request failed');
  });

  it.each([
    ['/probe/bad', 400, 'Bad request'],
    ['/probe/method', 405, 'Method not allowed'],
  ])(
    'titles a %s response as a client error, never as a server error',
    async (url, status, title) => {
      const res = await get(url);

      expect(res.statusCode).toBe(status);
      expect(res.json<{ title: string }>().title).toBe(title);
      expect(res.body).not.toContain('parser detail');
    },
  );

  it('maps an unknown route to 404 NOT_FOUND', async () => {
    const res = await get('/nope');

    expect(res.statusCode).toBe(404);
    expect(res.json<{ code: string }>().code).toBe('NOT_FOUND');
  });

  it('answers invalid input with 422 and the failing fields, never the values', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/probe/validate',
      payload: { email: 'not-an-email-LEAKCHECK', age: 3 },
    });
    const body = problemDetailsSchema.parse(res.json());

    expect(res.statusCode).toBe(422);
    expect(body.code).toBe('VALIDATION.FAILED');
    expect(body.errors?.map((e) => e.field).sort()).toEqual(['age', 'email']);
    expect(res.body).not.toContain('LEAKCHECK');
  });

  it('lets valid input through', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/probe/validate',
      payload: { email: 'a@b.co', age: 30 },
    });

    expect(res.statusCode).toBe(201);
  });
});
