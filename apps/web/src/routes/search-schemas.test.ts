import { describe, expect, it } from 'vitest';

import { isSafeReturnTo, returnToSchema, usersSearchSchema } from './search-schemas';

describe('returnTo validation', () => {
  it.each(['/users', '/users?limit=50&q=ana', '/a/b#frag'])('accepts internal path %s', (value) => {
    expect(returnToSchema.parse(value)).toBe(value);
  });

  it.each([
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    '/\u0000/evil.com',
    '/ /evil.com',
    '/\u00a0/evil.com',
    '/\u2028/evil.com',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    '/a/..//evil.com',
    'users',
  ])('rejects %j and falls back to undefined', (value) => {
    expect(isSafeReturnTo(value)).toBe(false);
    expect(returnToSchema.parse(value)).toBeUndefined();
  });
});

describe('usersSearchSchema view', () => {
  it('accepts the two sections and drops anything else', () => {
    expect(usersSearchSchema.parse({ view: 'team' }).view).toBe('team');
    expect(usersSearchSchema.parse({ view: 'directory' }).view).toBe('directory');
    expect(usersSearchSchema.parse({ view: 'admin' }).view).toBeUndefined();
    expect(usersSearchSchema.parse({}).view).toBeUndefined();
  });
});
