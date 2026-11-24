import { describe, expect, it } from 'vitest';

import { meetsMaxRank } from './client-entry.js';

describe('meetsMaxRank', () => {
  it('admits anyone when the client sets no limit', () => {
    expect(meetsMaxRank(3, null)).toBe(true);
  });

  it('admits the same rank as the limit and any rank with more authority', () => {
    expect(meetsMaxRank(2, 2)).toBe(true);
    expect(meetsMaxRank(0, 2)).toBe(true);
    expect(meetsMaxRank(1, 2)).toBe(true);
  });

  it('rejects a rank with less authority than the limit', () => {
    expect(meetsMaxRank(3, 2)).toBe(false);
    expect(meetsMaxRank(1, 0)).toBe(false);
  });
});
