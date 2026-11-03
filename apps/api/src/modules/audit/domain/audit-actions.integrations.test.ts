import { describe, expect, it } from 'vitest';

import { sanitizeMetadata } from './audit-actions.js';

describe('audit metadata allowlist for integrations', () => {
  it('accepts the documented fields of each integration action', () => {
    expect(sanitizeMetadata('integration.created', { kind: 'telegram_infra' })).toEqual({
      kind: 'telegram_infra',
    });
    expect(
      sanitizeMetadata('integration.secret_rotated', {
        kind: 'sms_pull',
        field: 'api_key',
        secretVersion: 2,
      }),
    ).toEqual({ kind: 'sms_pull', field: 'api_key', secretVersion: 2 });
    expect(
      sanitizeMetadata('integration.test_sent', { kind: 'telegram_security', outcome: 'sent' }),
    ).toEqual({ kind: 'telegram_security', outcome: 'sent' });
  });

  it.each([
    ['integration.created', 'botToken'],
    ['integration.updated', 'chatId'],
    ['integration.secret_rotated', 'value'],
    ['integration.archived', 'config'],
    ['integration.test_sent', 'responseBody'],
  ])('rejects the field %s.%s so a secret cannot reach the audit trail', (action, field) => {
    expect(() => sanitizeMetadata(action, { [field]: 'x' })).toThrow(
      expect.objectContaining({ code: 'AUDIT.METADATA_FIELD_NOT_ALLOWED' }) as Error,
    );
  });
});
