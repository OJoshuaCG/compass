import { describe, expect, it } from 'vitest';

import {
  RevealLimitNoticePayloadError,
  parseRevealLimitNoticePayload,
  serializeRevealLimitNotice,
} from './reveal-limit-notice.js';

const ACTOR_ID = '0198aaaa-0000-7000-8000-000000000001';
const RAISED_AT = new Date('2026-03-04T15:30:00.000Z');

describe('reveal limit notice payload', () => {
  it('round-trips what the producer serializes, with only ids and numbers', () => {
    const serialized = serializeRevealLimitNotice({
      actorId: ACTOR_ID,
      limitPerHour: 30,
      revealedInWindow: 30,
      windowSeconds: 3600,
      raisedAt: RAISED_AT,
    });

    expect(Object.keys(serialized).sort()).toEqual([
      'actorId',
      'limitPerHour',
      'raisedAt',
      'revealedInWindow',
      'windowSeconds',
    ]);
    expect(parseRevealLimitNoticePayload(serialized)).toEqual({
      actorId: ACTOR_ID,
      limitPerHour: 30,
      revealedInWindow: 30,
      windowMinutes: 60,
      raisedAt: RAISED_AT,
    });
  });

  it('accepts the older payload that only had the actor and the limit', () => {
    expect(parseRevealLimitNoticePayload({ actorId: ACTOR_ID, limitPerHour: 30 })).toEqual({
      actorId: ACTOR_ID,
      limitPerHour: 30,
      revealedInWindow: null,
      windowMinutes: null,
      raisedAt: null,
    });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['no actor', { limitPerHour: 30 }],
    ['an empty actor', { actorId: '', limitPerHour: 30 }],
    ['no limit', { actorId: ACTOR_ID }],
    ['a zero limit', { actorId: ACTOR_ID, limitPerHour: 0 }],
    ['a fractional limit', { actorId: ACTOR_ID, limitPerHour: 1.5 }],
    ['a text count', { actorId: ACTOR_ID, limitPerHour: 30, revealedInWindow: '30' }],
    ['a negative window', { actorId: ACTOR_ID, limitPerHour: 30, windowSeconds: -1 }],
    ['an invalid date', { actorId: ACTOR_ID, limitPerHour: 30, raisedAt: 'not a date' }],
    ['a numeric date', { actorId: ACTOR_ID, limitPerHour: 30, raisedAt: 1 }],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseRevealLimitNoticePayload(payload)).toThrow(RevealLimitNoticePayloadError);
  });

  it('never puts the payload in the error message', () => {
    let captured: unknown;
    try {
      parseRevealLimitNoticePayload({ actorId: 'secret-actor-marker', limitPerHour: 'bad' });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(RevealLimitNoticePayloadError);
    expect((captured as Error).message).not.toContain('secret-actor-marker');
  });
});
