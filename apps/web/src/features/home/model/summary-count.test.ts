import { describe, expect, it } from 'vitest';

import { summaryCountOf } from './summary-count';

describe('summaryCountOf', () => {
  it('counts the rows when there is no next page', () => {
    expect(summaryCountOf({ data: [1, 2, 3], page: { nextCursor: null } })).toEqual({
      kind: 'exact',
      value: 3,
    });
  });

  it('reports an exact zero for an empty complete list', () => {
    expect(summaryCountOf({ data: [], page: { nextCursor: null } })).toEqual({
      kind: 'exact',
      value: 0,
    });
  });

  it('refuses to count when another page exists and the server sends no total', () => {
    expect(summaryCountOf({ data: [1, 2], page: { nextCursor: 'abc' } })).toEqual({
      kind: 'unavailable',
    });
  });

  it('prefers the server total over the page length', () => {
    expect(summaryCountOf({ data: [1, 2], page: { nextCursor: 'abc', total: 57 } })).toEqual({
      kind: 'exact',
      value: 57,
    });
  });
});
