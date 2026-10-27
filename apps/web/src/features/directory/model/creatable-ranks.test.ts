import { describe, expect, it } from 'vitest';

import { creatableRanks } from './creatable-ranks';

describe('creatableRanks', () => {
  it('follows the creation matrix of the plan', () => {
    expect(creatableRanks(0)).toEqual([1, 2, 3]);
    expect(creatableRanks(1)).toEqual([2, 3]);
    expect(creatableRanks(2)).toEqual([3]);
    expect(creatableRanks(3)).toEqual([]);
  });
});
