import type { ManagedUser } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { invitableManagers } from './invitable-managers';

const person = (overrides: Partial<ManagedUser>): ManagedUser => ({
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Persona',
  email: 'persona@example.com',
  rank: 1,
  status: 'active',
  managedBy: null,
  ...overrides,
});

describe('invitableManagers', () => {
  const ACTOR_ID = '99999999-9999-4999-8999-999999999999';

  it('keeps only active people with a strictly higher rank than the invitee', () => {
    const higher = person({ id: 'a', rank: 1 });
    const sameRank = person({ id: 'b', rank: 2 });
    const lower = person({ id: 'c', rank: 3 });
    expect(invitableManagers([higher, sameRank, lower], ACTOR_ID, 2)).toEqual([higher]);
  });

  it('drops suspended, invited and deactivated people', () => {
    const active = person({ id: 'a' });
    const others = (['suspended', 'invited', 'deactivated'] as const).map((status) =>
      person({ id: status, status }),
    );
    expect(invitableManagers([active, ...others], ACTOR_ID, 3)).toEqual([active]);
  });

  it('excludes the actor, who is already the default option', () => {
    const actor = person({ id: ACTOR_ID });
    const other = person({ id: 'a' });
    expect(invitableManagers([actor, other], ACTOR_ID, 3)).toEqual([other]);
  });
});
