import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ErrorCode, pageQuerySchema, pageSchema, problemDetailsSchema } from './index.js';

describe('problemDetailsSchema', () => {
  it('accepts the RFC 9457 shape with a catalog code', () => {
    const parsed = problemDetailsSchema.parse({
      type: 'https://errors.internal/authz/hierarchy',
      title: 'Not allowed to manage this user',
      status: 403,
      code: ErrorCode.AUTHZ_HIERARCHY_NOT_IN_SUBTREE,
      requestId: '01J',
    });
    expect(parsed.code).toBe('AUTHZ.HIERARCHY.NOT_IN_SUBTREE');
  });

  it('rejects a code that is not in the catalog', () => {
    const result = problemDetailsSchema.safeParse({
      type: 't',
      title: 't',
      status: 403,
      code: 'MADE.UP',
      requestId: 'r',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-error statuses', () => {
    const result = problemDetailsSchema.safeParse({
      type: 't',
      title: 't',
      status: 200,
      code: ErrorCode.INTERNAL,
      requestId: 'r',
    });
    expect(result.success).toBe(false);
  });
});

describe('pageQuerySchema', () => {
  it('defaults the limit to 25', () => {
    expect(pageQuerySchema.parse({}).limit).toBe(25);
  });

  it('coerces a query-string limit', () => {
    expect(pageQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it.each([0, 5, 101, 1000])('rejects limit %i (outside 10/25/50/100)', (limit) => {
    expect(pageQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('rejects an unknown sort direction', () => {
    expect(pageQuerySchema.safeParse({ dir: 'sideways' }).success).toBe(false);
  });
});

describe('pageSchema', () => {
  const schema = pageSchema(z.object({ id: z.string() }));

  it('accepts a page with a next cursor', () => {
    expect(
      schema.safeParse({ data: [{ id: 'a' }], page: { nextCursor: 'abc', limit: 25 } }).success,
    ).toBe(true);
  });

  it('accepts the last page (null cursor) with an optional total', () => {
    expect(
      schema.safeParse({ data: [], page: { nextCursor: null, limit: 10, total: 0 } }).success,
    ).toBe(true);
  });

  it('rejects a limit above the maximum', () => {
    expect(schema.safeParse({ data: [], page: { nextCursor: null, limit: 500 } }).success).toBe(
      false,
    );
  });
});
