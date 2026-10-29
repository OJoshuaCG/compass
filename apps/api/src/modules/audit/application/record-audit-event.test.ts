import { describe, expect, it } from 'vitest';

import { asOrganizationId, asUserId, DomainError } from '../../../shared/kernel/index.js';
import type { RequestContext } from '../../../shared/kernel/index.js';
import { InMemoryAuditEventRepository } from '../testing/in-memory-audit-event-repository.js';
import type { AuditEventInput } from '../domain/audit-event.js';
import { RecordAuditEvent } from './record-audit-event.js';
import { VerifyAuditChain } from './verify-audit-chain.js';

const ORG_A = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const ORG_B = asOrganizationId('0198bbbb-0000-7000-8000-000000000002');

function setup(organizationId = ORG_A) {
  const repository = new InMemoryAuditEventRepository();
  let counter = 0;
  const context: RequestContext = {
    organizationId,
    actorId: asUserId('0198cccc-0000-7000-8000-000000000003'),
    requestId: 'req-1',
    sessionId: null,
    reauthAt: null,
  };
  const audit = new RecordAuditEvent({
    repository,
    context: { current: () => context },
    ids: { next: () => `0198dddd-0000-7000-8000-${String((counter += 1)).padStart(12, '0')}` },
  });
  return { repository, audit, verify: new VerifyAuditChain({ repository }) };
}

const input = (overrides: Partial<AuditEventInput> = {}): AuditEventInput => ({
  action: 'credential.revealed',
  actorId: asUserId('0198cccc-0000-7000-8000-000000000003'),
  targetType: 'credential',
  targetId: '0198eeee-0000-7000-8000-000000000004',
  outcome: 'success',
  reasonCode: null,
  ip: '203.0.113.7',
  requestId: 'req-1',
  metadata: { reason: 'rotating the shared account' },
  ...overrides,
});

describe('RecordAuditEvent', () => {
  it('stores the event with the id it generated and the allowed metadata', async () => {
    const { audit, repository } = setup();

    const result = await audit.record(input());

    expect(result.ok).toBe(true);
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      action: 'credential.revealed',
      metadata: { reason: 'rotating the shared account' },
    });
  });

  it('takes the organization from the request context, not from the caller', async () => {
    const { audit } = setup(ORG_B);

    const result = await audit.record(input());

    expect(result.ok && result.value.organizationId).toBe(ORG_B);
  });

  it('rejects a metadata field that is not on the allowlist, without echoing its value', async () => {
    const { audit, repository } = setup();

    const result = await audit.record(input({ metadata: { password: 'hunter2' } }));

    expect(!result.ok && result.error.code).toBe('AUDIT.METADATA_FIELD_NOT_ALLOWED');
    expect(!result.ok && JSON.stringify(result.error.meta)).not.toContain('hunter2');
    expect(repository.events).toHaveLength(0);
  });

  it('allows no metadata at all for an action without an allowlist entry', async () => {
    const { audit } = setup();
    const result = await audit.record(input({ action: 'user.logged_in', metadata: { x: 1 } }));
    expect(!result.ok && result.error.code).toBe('AUDIT.METADATA_FIELD_NOT_ALLOWED');
  });

  it('rejects malformed action names and over-long values', async () => {
    const { audit } = setup();
    const badName = await audit.record(input({ action: 'Not A Valid Action' }));
    // El motivo del revelado admite hasta 500 caracteres (decisión del dueño, B2): 501 ya excede.
    const longValue = await audit.record(input({ metadata: { reason: 'x'.repeat(501) } }));
    const longestAllowed = await audit.record(input({ metadata: { reason: 'x'.repeat(500) } }));

    expect(badName.ok).toBe(false);
    expect(longValue.ok).toBe(false);
    expect(longestAllowed.ok).toBe(true);
  });

  it('requires a reason code for denials and accepts them when present', async () => {
    const { audit, repository } = setup();

    const missing = await audit.record(input({ outcome: 'denied', reasonCode: null }));
    const empty = await audit.record(input({ outcome: 'denied', reasonCode: '' }));
    const valid = await audit.record(input({ outcome: 'denied', reasonCode: 'AUTHZ.PERMISSION' }));

    expect(!missing.ok && missing.error.code).toBe('AUDIT.REASON_CODE_REQUIRED');
    expect(!empty.ok && empty.error.code).toBe('AUDIT.REASON_CODE_REQUIRED');
    expect(valid.ok).toBe(true);
    expect(repository.events).toHaveLength(1);
  });

  it('does not require a reason code for successful events', async () => {
    const { audit } = setup();
    expect((await audit.record(input({ outcome: 'success', reasonCode: null }))).ok).toBe(true);
  });

  it('returns real DomainError instances for allowlist violations', async () => {
    const { audit } = setup();
    const result = await audit.record(input({ metadata: { secret: 'x' } }));
    expect(!result.ok && result.error).toBeInstanceOf(DomainError);
  });

  it('fails closed: if the audit write fails, the error propagates to the caller', async () => {
    const { audit, repository } = setup();
    repository.failNextAppend = true;

    await expect(audit.record(input())).rejects.toThrow('audit storage unavailable');
  });
});

describe('VerifyAuditChain', () => {
  it('reports an intact chain', async () => {
    const { verify } = setup();
    expect(await verify.execute()).toEqual({ valid: true });
  });

  it('reports the first broken sequence number', async () => {
    const { verify, repository } = setup();
    repository.brokenSeq = 7n;
    expect(await verify.execute()).toEqual({ valid: false, firstBrokenSeq: 7n });
  });
});
