import { describe, expect, it } from 'vitest';

import { readInvitationToken } from './invitation-token';

describe('readInvitationToken', () => {
  it('prefers the fragment over the query', () => {
    expect(readInvitationToken('from-query', '#token=from-hash')).toEqual({
      token: 'from-hash',
      fromUrl: true,
    });
  });

  it('reads the query when there is no fragment', () => {
    expect(readInvitationToken('from-query', '')).toEqual({ token: 'from-query', fromUrl: true });
  });

  it('reports a missing token', () => {
    expect(readInvitationToken(undefined, '#other=1')).toEqual({
      token: undefined,
      fromUrl: false,
    });
    expect(readInvitationToken('', '')).toEqual({ token: undefined, fromUrl: false });
  });
});
