import { SHARE_LEVELS, type ShareLevel } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { canArchiveAccount, canEditAccount, levelSatisfies } from './account-access';
import {
  addSuggestedTag,
  buildCreateBody,
  buildUpdateBody,
  isEmptyUpdate,
  parseTags,
  suggestTags,
} from './account-form';

const PLATFORM_ID = '11111111-1111-4111-8111-111111111111';

describe('levelSatisfies', () => {
  it('orders the levels USE < VIEW < EDIT < MANAGE', () => {
    const expectations: [ShareLevel, ShareLevel, boolean][] = [
      ['USE', 'EDIT', false],
      ['VIEW', 'EDIT', false],
      ['EDIT', 'EDIT', true],
      ['MANAGE', 'EDIT', true],
      ['EDIT', 'MANAGE', false],
      ['MANAGE', 'MANAGE', true],
    ];
    for (const [actual, required, expected] of expectations) {
      expect(levelSatisfies(actual, required), `${actual} vs ${required}`).toBe(expected);
    }
  });
});

describe('canEditAccount / canArchiveAccount', () => {
  it('needs the permission AND the level', () => {
    for (const level of SHARE_LEVELS) {
      const editLevelOk = level === 'EDIT' || level === 'MANAGE';
      expect(canEditAccount(true, level), `edit ${level}`).toBe(editLevelOk);
      expect(canEditAccount(false, level), `edit without permission ${level}`).toBe(false);
      expect(canArchiveAccount(true, level), `archive ${level}`).toBe(level === 'MANAGE');
      expect(canArchiveAccount(false, level), `archive without permission ${level}`).toBe(false);
    }
  });

  it('offers nothing when there is no level (inventory rows)', () => {
    expect(canEditAccount(true, null)).toBe(false);
    expect(canArchiveAccount(true, null)).toBe(false);
  });
});

describe('parseTags', () => {
  it('trims, drops empty entries and repeated tags keeping the first order', () => {
    expect(parseTags(' a, b ,,a, c ')).toEqual(['a', 'b', 'c']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('buildCreateBody', () => {
  it('omits an empty handle and empty tags', () => {
    expect(
      buildCreateBody({ platformId: PLATFORM_ID, displayName: ' Nómina ', handle: ' ', tags: '' }),
    ).toEqual({ platformId: PLATFORM_ID, displayName: 'Nómina' });
  });

  it('sends handle and tags when present', () => {
    expect(
      buildCreateBody({
        platformId: PLATFORM_ID,
        displayName: 'Nómina',
        handle: 'rh@example.com',
        tags: 'rh, finanzas',
      }),
    ).toEqual({
      platformId: PLATFORM_ID,
      displayName: 'Nómina',
      handle: 'rh@example.com',
      tags: ['rh', 'finanzas'],
    });
  });
});

describe('buildUpdateBody', () => {
  const account = { displayName: 'Nómina', handle: 'rh@example.com', tags: ['rh'] };

  it('sends only what changed', () => {
    expect(
      buildUpdateBody(account, { displayName: 'Nómina 2', handle: 'rh@example.com', tags: 'rh' }),
    ).toEqual({ displayName: 'Nómina 2' });
  });

  it('sends null to clear the handle', () => {
    expect(buildUpdateBody(account, { displayName: 'Nómina', handle: '  ', tags: 'rh' })).toEqual({
      handle: null,
    });
  });

  it('is empty when nothing changed', () => {
    const body = buildUpdateBody(account, {
      displayName: 'Nómina',
      handle: 'rh@example.com',
      tags: 'rh',
    });
    expect(isEmptyUpdate(body)).toBe(true);
  });
});

describe('suggestTags', () => {
  const existing = ['ads', 'Brand MX', 'brand mx', 'Launch 2026'];

  it('offers every unused tag while nothing is being typed', () => {
    expect(suggestTags(existing, '')).toEqual(existing);
    expect(suggestTags(existing, 'ads, ')).toEqual(['Brand MX', 'brand mx', 'Launch 2026']);
  });

  it('completes the fragment after the last comma, ignoring case', () => {
    expect(suggestTags(existing, 'ads, BRAND')).toEqual(['Brand MX', 'brand mx']);
    expect(suggestTags(existing, 'launch')).toEqual(['Launch 2026']);
    expect(suggestTags(existing, 'nothing-like-it')).toEqual([]);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 20 }, (_, index) => `tag-${String(index)}`);
    expect(suggestTags(many, '')).toHaveLength(8);
  });
});

describe('addSuggestedTag', () => {
  const existing = ['ads', 'Brand MX', 'rh'];

  it('replaces the fragment being typed and leaves room for the next tag', () => {
    expect(addSuggestedTag('', 'ads', existing)).toBe('ads, ');
    expect(addSuggestedTag('ads, bra', 'Brand MX', existing)).toBe('ads, Brand MX, ');
    expect(addSuggestedTag('ads, ', 'Brand MX', existing)).toBe('ads, Brand MX, ');
    expect(addSuggestedTag('bra', 'Brand MX', existing)).toBe('Brand MX, ');
  });

  it('keeps a last tag that already exists, as when editing an account', () => {
    expect(addSuggestedTag('rh', 'ads', existing)).toBe('rh, ads, ');
    expect(suggestTags(existing, 'rh')).toEqual(['ads', 'Brand MX']);
  });

  it('never repeats a tag already in the field', () => {
    expect(addSuggestedTag('ads, Brand MX, a', 'ads', existing)).toBe('ads, Brand MX, ');
  });
});
