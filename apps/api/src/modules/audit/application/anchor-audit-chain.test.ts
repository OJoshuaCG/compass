import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import type { ScopeContext, TenantScope } from '../../organization/index.js';
import type { AuditAnchor, AuditAnchorManifest } from '../domain/audit-anchor.js';
import {
  AUDIT_ANCHOR_RETENTION_YEARS,
  AnchorAuditChain,
  auditAnchorRetainUntil,
} from './anchor-audit-chain.js';
import type {
  AnchorFailureAlerter,
  AuditAnchorLedger,
  AuditAnchorPublisher,
} from './ports/audit-anchor-ports.js';

const ORG_OK = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const ORG_BROKEN = asOrganizationId('0198aaaa-0000-7000-8000-000000000002');
const NOW = new Date('2026-01-01T12:00:00.000Z');
const HASH_A = 'aa'.repeat(32);
const HASH_B = 'bb'.repeat(32);
const HASH_C = 'cc'.repeat(32);

function anchorFor(organizationId: OrganizationId): AuditAnchor {
  return {
    organizationId,
    manifestNumber: 3n,
    anchoredSeq: 42n,
    anchoredHash: HASH_A,
    prevManifestHash: HASH_B,
    manifestHash: HASH_C,
    anchoredAtMicros: 1_767_268_800_000_000n,
  };
}

/** Registra en qué organización corre cada llamada y si la función del contexto terminó con error. */
function recordingScope(log: string[]): TenantScope {
  return {
    runAs: async <T>(context: ScopeContext, fn: () => Promise<T>): Promise<T> => {
      log.push(`begin ${context.organizationId}`);
      try {
        const result = await fn();
        log.push(`commit ${context.organizationId}`);
        return result;
      } catch (error) {
        log.push(`rollback ${context.organizationId}`);
        throw error;
      }
    },
    runAsAtomic: (_context, fn) => fn(),
  };
}

/** Alerta que no debe llamarse: las pruebas sin fallos la usan para detectar un aviso indebido. */
const unexpectedAlerter: AnchorFailureAlerter = {
  alertAnchorFailed: () => Promise.reject(new Error('no alert expected')),
};

describe('AnchorAuditChain', () => {
  it('records and publishes one manifest per organization, retained for two calendar years', async () => {
    const log: string[] = [];
    const published: { manifest: AuditAnchorManifest; retainUntil: Date }[] = [];
    const ledger: AuditAnchorLedger = {
      record: (organizationId) => {
        log.push(`record ${organizationId}`);
        return Promise.resolve(anchorFor(organizationId));
      },
    };
    const publisher: AuditAnchorPublisher = {
      publish: (manifest, retainUntil) => {
        log.push(`publish ${manifest.objectKey}`);
        published.push({ manifest, retainUntil });
        return Promise.resolve();
      },
    };
    const anchorChain = new AnchorAuditChain({
      organizations: { listIds: () => Promise.resolve([ORG_OK]) },
      ledger,
      publisher,
      scope: recordingScope(log),
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
      alerter: unexpectedAlerter,
    });

    const summary = await anchorChain.execute();

    expect(summary).toEqual({ organizations: 1, anchored: 1, failedOrganizations: [] });
    const objectKey = `audit-anchors/${ORG_OK}/000000000003-${HASH_C}.json`;
    // El registro local y la publicación ocurren dentro de la transacción de la organización.
    expect(log).toEqual([
      `begin ${ORG_OK}`,
      `record ${ORG_OK}`,
      `publish ${objectKey}`,
      `commit ${ORG_OK}`,
    ]);
    expect(AUDIT_ANCHOR_RETENTION_YEARS).toBe(2);
    expect(published[0]?.retainUntil).toEqual(new Date('2028-01-01T12:00:00.000Z'));
    expect(JSON.parse(published[0]?.manifest.body ?? '{}')).toEqual({
      format: 'compass.audit-anchor/v1',
      organizationId: ORG_OK,
      manifestNumber: '3',
      anchoredSeq: '42',
      anchoredHash: HASH_A,
      prevManifestHash: HASH_B,
      manifestHash: HASH_C,
      anchoredAtMicros: '1767268800000000',
      anchoredAt: '2026-01-01T12:00:00.000Z',
    });
  });

  it('rolls back the local record when publishing fails, alerts the Root and keeps anchoring the others', async () => {
    const log: string[] = [];
    const alertedAt: Date[] = [];
    const publishFailure = Object.assign(new Error('bucket said no to secret-looking detail'), {
      name: 'AuditAnchorPublishError',
      code: 'AccessDenied',
    });
    const anchorChain = new AnchorAuditChain({
      organizations: { listIds: () => Promise.resolve([ORG_BROKEN, ORG_OK]) },
      ledger: { record: (organizationId) => Promise.resolve(anchorFor(organizationId)) },
      publisher: {
        publish: (manifest) =>
          manifest.objectKey.includes(ORG_BROKEN)
            ? Promise.reject(publishFailure)
            : Promise.resolve(),
      },
      scope: recordingScope(log),
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
      alerter: {
        alertAnchorFailed: (occurredAt) => {
          log.push('alert');
          alertedAt.push(occurredAt);
          return Promise.resolve();
        },
      },
    });

    const summary = await anchorChain.execute();

    expect(summary).toEqual({
      organizations: 2,
      anchored: 1,
      failedOrganizations: [
        {
          organizationId: ORG_BROKEN,
          reason: 'AuditAnchorPublishError (AccessDenied)',
          alerted: true,
        },
      ],
    });
    // La alerta va en una transacción propia de la organización: la del ancla ya se revirtió y se la llevaría.
    expect(log).toEqual([
      `begin ${ORG_BROKEN}`,
      `rollback ${ORG_BROKEN}`,
      `begin ${ORG_BROKEN}`,
      'alert',
      `commit ${ORG_BROKEN}`,
      `begin ${ORG_OK}`,
      `commit ${ORG_OK}`,
    ]);
    expect(alertedAt).toEqual([NOW]);
  });

  it('reports an alert that could not be raised and still anchors the other organizations', async () => {
    const log: string[] = [];
    const anchorChain = new AnchorAuditChain({
      organizations: { listIds: () => Promise.resolve([ORG_BROKEN, ORG_OK]) },
      ledger: {
        record: (organizationId) =>
          organizationId === ORG_BROKEN
            ? Promise.reject(Object.assign(new Error('db'), { name: 'DatabaseError' }))
            : Promise.resolve(anchorFor(organizationId)),
      },
      publisher: { publish: () => Promise.resolve() },
      scope: recordingScope(log),
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
      alerter: { alertAnchorFailed: () => Promise.reject(new Error('outbox unavailable')) },
    });

    const summary = await anchorChain.execute();

    expect(summary).toEqual({
      organizations: 2,
      anchored: 1,
      failedOrganizations: [
        { organizationId: ORG_BROKEN, reason: 'DatabaseError', alerted: false },
      ],
    });
    expect(log.slice(-2)).toEqual([`begin ${ORG_OK}`, `commit ${ORG_OK}`]);
  });

  it('retains for two calendar years even across a leap day, never less', () => {
    // 2026-11-04 + 730 días = 2028-11-03: un día corto porque 2028 tiene 29 de febrero.
    expect(auditAnchorRetainUntil(new Date('2026-11-04T03:23:00.000Z'))).toEqual(
      new Date('2028-11-04T03:23:00.000Z'),
    );
    expect(auditAnchorRetainUntil(new Date('2028-02-29T00:00:00.000Z'))).toEqual(
      new Date('2030-03-01T00:00:00.000Z'),
    );
  });
});
