import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { ScopeContext, TenantScope } from '../../organization/index.js';
import type { AuditEventRepository } from './ports/audit-event-repository.js';
import { VerifyAuditChains } from './verify-audit-chains.js';

const ORG_OK = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const ORG_BROKEN = asOrganizationId('0198aaaa-0000-7000-8000-000000000002');
const ORG_FAILING = asOrganizationId('0198aaaa-0000-7000-8000-000000000003');

/** Cada llamada corre "dentro" de la organización de su contexto, igual que el aislamiento real. */
function scopeTracking(current: { organizationId: string | null }): TenantScope {
  return {
    runAs: async <T>(context: ScopeContext, fn: () => Promise<T>): Promise<T> => {
      current.organizationId = context.organizationId;
      try {
        return await fn();
      } finally {
        current.organizationId = null;
      }
    },
    runAsAtomic: (_context, fn) => fn(),
  };
}

describe('VerifyAuditChains', () => {
  it('verifies each organization inside its own context and reports valid, broken and unverifiable ones apart', async () => {
    const current: { organizationId: string | null } = { organizationId: null };
    const verifiedIn: (string | null)[] = [];
    const repository = {
      firstBrokenSeq: () => {
        verifiedIn.push(current.organizationId);
        if (current.organizationId === ORG_BROKEN) return Promise.resolve(7n);
        if (current.organizationId === ORG_FAILING) {
          return Promise.reject(
            Object.assign(new Error('table audit_events leaks'), { code: '57014' }),
          );
        }
        return Promise.resolve(null);
      },
    } as unknown as AuditEventRepository;

    const summary = await new VerifyAuditChains({
      organizations: { listIds: () => Promise.resolve([ORG_OK, ORG_BROKEN, ORG_FAILING]) },
      repository,
      scope: scopeTracking(current),
      ids: { next: () => '0198bbbb-0000-7000-8000-000000000001' },
    }).execute();

    expect(verifiedIn).toEqual([ORG_OK, ORG_BROKEN, ORG_FAILING]);
    expect(summary).toEqual({
      organizations: 3,
      valid: 1,
      brokenChains: [{ organizationId: ORG_BROKEN, firstBrokenSeq: 7n }],
      failedOrganizations: [{ organizationId: ORG_FAILING, reason: 'Error (57014)' }],
    });
    expect(
      JSON.stringify(summary, (_key, value: unknown) =>
        typeof value === 'bigint' ? String(value) : value,
      ),
    ).not.toContain('leaks');
  });

  it('reports an empty summary when there are no organizations', async () => {
    const summary = await new VerifyAuditChains({
      organizations: { listIds: () => Promise.resolve([]) },
      repository: {
        firstBrokenSeq: () => Promise.resolve(null),
      } as unknown as AuditEventRepository,
      scope: scopeTracking({ organizationId: null }),
      ids: { next: () => '0198bbbb-0000-7000-8000-000000000001' },
    }).execute();

    expect(summary).toEqual({
      organizations: 0,
      valid: 0,
      brokenChains: [],
      failedOrganizations: [],
    });
  });
});
