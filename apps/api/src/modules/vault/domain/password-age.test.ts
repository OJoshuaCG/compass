import { describe, expect, it } from 'vitest';

import { classifyPasswordAge, passwordAgeCutoff } from './password-age.js';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const daysAgo = (days: number, extraMilliseconds = 0): Date =>
  new Date(passwordAgeCutoff(NOW, days).getTime() - extraMilliseconds);

describe('classifyPasswordAge', () => {
  it('has no status when the account has no credentials', () => {
    expect(classifyPasswordAge(null, NOW)).toBe('none');
  });

  it('is fresh for a change made today and exactly 60 days ago', () => {
    expect(classifyPasswordAge(NOW, NOW)).toBe('fresh');
    expect(classifyPasswordAge(daysAgo(60), NOW)).toBe('fresh');
  });

  it('is aging from just over 60 days up to exactly 90 days', () => {
    expect(classifyPasswordAge(daysAgo(60, 1), NOW)).toBe('aging');
    expect(classifyPasswordAge(daysAgo(90), NOW)).toBe('aging');
  });

  it('is stale from just over 90 days', () => {
    expect(classifyPasswordAge(daysAgo(90, 1), NOW)).toBe('stale');
    expect(classifyPasswordAge(daysAgo(400), NOW)).toBe('stale');
  });
});
