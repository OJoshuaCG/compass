import { describe, expect, it, vi } from 'vitest';

import { ManualClock } from '../testing/manual-clock.js';
import { DekCache } from './dek-cache.js';

const key = (value: number): Uint8Array => new Uint8Array(32).fill(value);

describe('DekCache', () => {
  it('serves from cache without calling the loader again', async () => {
    const cache = new DekCache({ clock: new ManualClock() });
    const load = vi.fn(() => Promise.resolve(key(1)));

    await cache.withKey('a', load, () => undefined);
    await cache.withKey('a', load, () => undefined);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one load between concurrent requests (single-flight)', async () => {
    const cache = new DekCache({ clock: new ManualClock() });
    const load = vi.fn(async () => {
      await Promise.resolve();
      return key(2);
    });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => cache.withKey('a', load, (k) => k[0])),
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r === 2)).toBe(true);
  });

  it('evicts after the TTL and reloads', async () => {
    const clock = new ManualClock();
    const cache = new DekCache({ clock, ttlMs: 10 * 60 * 1000 });
    const load = vi.fn(() => Promise.resolve(key(3)));

    await cache.withKey('a', load, () => undefined);
    clock.advance(10 * 60 * 1000 - 1);
    await cache.withKey('a', load, () => undefined);
    expect(load).toHaveBeenCalledTimes(1);

    clock.advance(1);
    await cache.withKey('a', load, () => undefined);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('evicts after the usage limit and reloads', async () => {
    const cache = new DekCache({ clock: new ManualClock(), maxUses: 3 });
    const load = vi.fn(() => Promise.resolve(key(4)));

    for (let i = 0; i < 3; i += 1) await cache.withKey('a', load, () => undefined);
    expect(load).toHaveBeenCalledTimes(1);

    await cache.withKey('a', load, () => undefined);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('overwrites the key buffer with zeros on eviction (TTL)', async () => {
    const clock = new ManualClock();
    const cache = new DekCache({ clock, ttlMs: 1000 });
    const loaded = key(9);

    await cache.withKey(
      'a',
      () => Promise.resolve(loaded),
      () => undefined,
    );
    expect(loaded.some((b) => b !== 0)).toBe(true);

    clock.advance(1000);
    await cache.withKey(
      'a',
      () => Promise.resolve(key(5)),
      () => undefined,
    );

    expect(loaded.every((b) => b === 0)).toBe(true);
  });

  it('overwrites keys with zeros on clear()', async () => {
    const cache = new DekCache({ clock: new ManualClock() });
    const loaded = key(9);
    await cache.withKey(
      'a',
      () => Promise.resolve(loaded),
      () => undefined,
    );

    cache.clear();

    expect(loaded.every((b) => b === 0)).toBe(true);
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry beyond maxEntries, zeroing it', async () => {
    const cache = new DekCache({ clock: new ManualClock(), maxEntries: 2 });
    const first = key(1);
    await cache.withKey(
      'a',
      () => Promise.resolve(first),
      () => undefined,
    );
    await cache.withKey(
      'b',
      () => Promise.resolve(key(2)),
      () => undefined,
    );
    await cache.withKey(
      'a',
      () => Promise.resolve(key(8)),
      () => undefined,
    ); // toca 'a': 'b' queda más viejo
    await cache.withKey(
      'c',
      () => Promise.resolve(key(3)),
      () => undefined,
    );

    expect(cache.size).toBe(2);
    expect(first.some((b) => b !== 0)).toBe(true); // 'a' sobrevive
  });

  it('does not cache a failed load and lets the next call retry', async () => {
    const cache = new DekCache({ clock: new ManualClock() });
    const load = vi
      .fn<() => Promise<Uint8Array>>()
      .mockRejectedValueOnce(new Error('kms down'))
      .mockResolvedValueOnce(key(6));

    await expect(cache.withKey('a', load, () => undefined)).rejects.toThrow('kms down');
    await expect(cache.withKey('a', load, (k) => k[0])).resolves.toBe(6);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('propagates a failed shared load to every concurrent waiter', async () => {
    const cache = new DekCache({ clock: new ManualClock() });
    const load = vi.fn(() => Promise.reject(new Error('kms down')));

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => cache.withKey('a', load, () => undefined)),
    );

    expect(settled.every((s) => s.status === 'rejected')).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
