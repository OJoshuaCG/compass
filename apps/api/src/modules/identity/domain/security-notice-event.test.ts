import { describe, expect, it } from 'vitest';

import {
  parseSecurityNoticePayload,
  SecurityNoticePayloadError,
  securityNoticeHandlerKey,
  serializeSecurityNotice,
} from './security-notice-event.js';

const USER_ID = '0198aaaa-0000-7000-8000-000000000001';

describe('security notice event', () => {
  it('serializes only the user id, the kind and the moment, and parses them back', () => {
    const occurredAt = new Date('2026-03-04T15:30:00.000Z');

    const serialized = serializeSecurityNotice({
      userId: USER_ID,
      kind: 'totp_removed',
      occurredAt,
    });

    expect(Object.keys(serialized).sort()).toEqual(['kind', 'occurredAt', 'userId']);
    expect(parseSecurityNoticePayload(serialized)).toEqual({
      userId: USER_ID,
      kind: 'totp_removed',
      occurredAt,
    });
  });

  it('marks an invalid payload as not retryable', () => {
    expect(new SecurityNoticePayloadError().retryable).toBe(false);
  });

  it('keeps the receipt key within the 100 characters of handler_key', () => {
    expect(securityNoticeHandlerKey(USER_ID).length).toBeLessThanOrEqual(100);
    expect(securityNoticeHandlerKey(USER_ID)).toBe(`identity.security-notice:${USER_ID}`);
  });
});
