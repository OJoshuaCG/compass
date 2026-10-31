import { describe, expect, it } from 'vitest';

import {
  countByType,
  createDemoAuditFetcher,
  createDemoEvents,
  filterEvents,
  previousHash,
} from './demo-events';

const events = createDemoEvents();

describe('demo audit events', () => {
  it('counts by type within the period, ignoring older events', () => {
    const counts = countByType(events, '7d');
    expect(counts.all).toBe(11);
    expect(counts.denied).toBe(2);
    expect(counts.session).toBe(1);
    expect(countByType(events, '30d').session).toBe(2);
    expect(countByType(events, '24h').all).toBe(6);
  });

  it('filters by type and searches person, object and reason case-insensitively', () => {
    expect(filterEvents(events, 'denied', '30d', undefined).map((e) => e.id)).toEqual([
      'evt_e2',
      'evt_e6',
    ]);
    expect(filterEvents(events, 'all', '30d', 'FIN DE CONTRATO').map((e) => e.id)).toEqual([
      'evt_e8',
    ]);
    expect(filterEvents(events, 'reveal', '30d', 'sofía').map((e) => e.id)).toEqual(['evt_e1']);
  });

  it('chains each event to the next older one; the oldest starts the chain', () => {
    const [newest, second] = events;
    const oldest = events.at(-1);
    if (newest === undefined || second === undefined || oldest === undefined)
      throw new Error('no data');
    expect(previousHash(newest, events)).toBe(second.hash);
    expect(previousHash(oldest, events)).toBeNull();
  });

  it('pages newest first with an opaque cursor', async () => {
    const fetchPage = createDemoAuditFetcher('all', '30d', events, 0);
    const signal = new AbortController().signal;
    const first = await fetchPage({ limit: 10 }, signal);
    expect(first.data).toHaveLength(10);
    expect(first.data[0]?.id).toBe('evt_e1');
    expect(first.page.nextCursor).toBe('10');
    const second = await fetchPage({ limit: 10, cursor: '10' }, signal);
    expect(second.data.map((e) => e.id)).toEqual(['evt_e11', 'evt_e12']);
    expect(second.page.nextCursor).toBeNull();
  });
});
