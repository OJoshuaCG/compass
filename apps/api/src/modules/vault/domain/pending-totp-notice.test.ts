import { describe, expect, it } from 'vitest';

import {
  PENDING_TOTP_NOTICE_AFTER_MS,
  PENDING_TOTP_NOTICE_HANDLER_KEY,
  PendingTotpNoticePayloadError,
  parsePendingTotpNoticePayload,
  pendingTotpNoticeHandlerKey,
  serializePendingTotpNotice,
} from './pending-totp-notice.js';

const CREDENTIAL_ID = '0198aaaa-0000-7000-8000-000000000001';
const REGISTERED_BY = '0198bbbb-0000-7000-8000-000000000001';
const REGISTERED_AT = new Date('2026-03-04T15:30:00.000Z');

describe('pending totp notice payload', () => {
  it('waits exactly 24 hours before the notice is due', () => {
    expect(PENDING_TOTP_NOTICE_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('serializes only ids and one date, never a secret or a name', () => {
    const payload = serializePendingTotpNotice({
      credentialId: CREDENTIAL_ID,
      registeredBy: REGISTERED_BY,
      registeredAt: REGISTERED_AT,
    });

    expect(Object.keys(payload).sort()).toEqual(['credentialId', 'registeredAt', 'registeredBy']);
    expect(payload.registeredAt).toBe('2026-03-04T15:30:00.000Z');
  });

  it('round-trips through serialize and parse', () => {
    const parsed = parsePendingTotpNoticePayload(
      serializePendingTotpNotice({
        credentialId: CREDENTIAL_ID,
        registeredBy: REGISTERED_BY,
        registeredAt: REGISTERED_AT,
      }),
    );

    expect(parsed).toEqual({
      credentialId: CREDENTIAL_ID,
      registeredBy: REGISTERED_BY,
      registeredAt: REGISTERED_AT,
    });
  });

  it.each([
    ['not an object', 'text'],
    ['an array', []],
    ['null', null],
    ['without credentialId', { registeredBy: REGISTERED_BY, registeredAt: '2026-03-04T15:30:00Z' }],
    [
      'with an empty registeredBy',
      { credentialId: CREDENTIAL_ID, registeredBy: '', registeredAt: '2026-03-04T15:30:00Z' },
    ],
    [
      'with a numeric date',
      { credentialId: CREDENTIAL_ID, registeredBy: REGISTERED_BY, registeredAt: 1 },
    ],
    [
      'with an unparseable date',
      { credentialId: CREDENTIAL_ID, registeredBy: REGISTERED_BY, registeredAt: 'yesterday' },
    ],
  ])(
    'rejects a payload %s with a stable error code and no content in the message',
    (_name, payload) => {
      const failure: unknown = (() => {
        try {
          parsePendingTotpNoticePayload(payload);
          return null;
        } catch (error) {
          return error;
        }
      })();

      expect(failure).toBeInstanceOf(PendingTotpNoticePayloadError);
      expect(failure).toMatchObject({ code: 'VAULT.PENDING_TOTP_NOTICE_PAYLOAD_INVALID' });
      expect((failure as Error).message).not.toContain(CREDENTIAL_ID);
    },
  );

  it('builds a per-recipient receipt key that fits the 100 character column', () => {
    const key = pendingTotpNoticeHandlerKey(REGISTERED_BY);

    expect(key).toBe(`${PENDING_TOTP_NOTICE_HANDLER_KEY}:${REGISTERED_BY}`);
    expect(key.length).toBeLessThanOrEqual(100);
  });
});
