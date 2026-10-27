import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('merges conditional classes', () => {
    const hidden = Math.random() > 2;
    expect(cn('p-2', hidden && 'hidden', undefined, 'text-text')).toBe('p-2 text-text');
  });

  it('lets the last conflicting utility win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
