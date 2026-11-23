import { describe, expect, it } from 'vitest';

import { createDemoAccounts, createDemoVaultFetcher, filterAccounts } from './demo-accounts';

const accounts = createDemoAccounts();
const platforms = (list: { platform: string }[]) => list.map((account) => account.platform);

describe('filterAccounts', () => {
  it('"all" keeps every account', () => {
    expect(filterAccounts(accounts, 'all', undefined)).toHaveLength(accounts.length);
  });

  it('"mine" keeps the accounts I manage', () => {
    expect(platforms(filterAccounts(accounts, 'mine', undefined))).toEqual([
      'Instagram',
      'Facebook',
      'X',
      'Gmail',
    ]);
  });

  it('"noTotp" keeps accounts without a verified second factor', () => {
    expect(platforms(filterAccounts(accounts, 'noTotp', undefined))).toEqual([
      'TikTok',
      'LinkedIn',
    ]);
  });

  it('"rotate" keeps accounts whose password is due for rotation', () => {
    expect(platforms(filterAccounts(accounts, 'rotate', undefined))).toEqual(['X']);
  });

  it('searches name, platform, handle and tags, case-insensitively', () => {
    expect(platforms(filterAccounts(accounts, 'all', 'YOUTUBE'))).toEqual(['YouTube']);
    expect(platforms(filterAccounts(accounts, 'all', '@marca_soporte'))).toEqual(['X']);
    expect(platforms(filterAccounts(accounts, 'all', 'corporativo'))).toEqual(['LinkedIn']);
    expect(filterAccounts(accounts, 'rotate', 'instagram')).toEqual([]);
  });
});

describe('createDemoVaultFetcher', () => {
  it('sorts by days since rotation and paginates with an opaque cursor', async () => {
    const fetchPage = createDemoVaultFetcher('all', accounts, 0);
    const signal = new AbortController().signal;
    const first = await fetchPage({ limit: 10, sort: 'rotatedDaysAgo', dir: 'desc' }, signal);
    expect(first.data[0]?.platform).toBe('X');
    expect(first.page).toEqual({ nextCursor: null, limit: 10, total: accounts.length });
  });
});
