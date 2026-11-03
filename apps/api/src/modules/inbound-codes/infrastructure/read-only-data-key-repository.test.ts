import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import { ReadOnlyDataKeyRepository } from './read-only-data-key-repository.js';

const ORGANIZATION = asOrganizationId('0198aaaa-0000-7000-8000-000000000010');

const ROW = {
  organization_id: ORGANIZATION,
  version: 3,
  wrapped_dek: Buffer.from([1, 2, 3]),
  kms_key_ref: 'local:kek-1',
  status: 'active',
};

function providerReturning(rows: unknown[], statements: string[]): TransactionProvider {
  return {
    current: () => ({
      query: (statement: string) => {
        statements.push(statement);
        return Promise.resolve({ rows, rowCount: rows.length });
      },
    }),
  } as unknown as TransactionProvider;
}

describe('ReadOnlyDataKeyRepository', () => {
  it('maps a stored key and asks only for the columns the worker role may read', async () => {
    const statements: string[] = [];
    const repository = new ReadOnlyDataKeyRepository(providerReturning([ROW], statements));

    const active = await repository.findActive(ORGANIZATION);
    const byVersion = await repository.findByVersion(ORGANIZATION, 3);

    const expected = {
      organizationId: ORGANIZATION,
      version: 3,
      wrapped: new Uint8Array([1, 2, 3]),
      kmsKeyRef: 'local:kek-1',
      status: 'active',
    };
    expect(active).toEqual(expected);
    expect(byVersion).toEqual(expected);
    for (const statement of statements) {
      expect(statement).toContain(
        'select organization_id, version, wrapped_dek, kms_key_ref, status',
      );
      expect(statement).not.toMatch(/select\s+\*/i);
    }
  });

  it('returns null for an unknown version but fails before the resolver can reach the KMS when there is no active key', async () => {
    const repository = new ReadOnlyDataKeyRepository(providerReturning([], []));

    await expect(repository.findByVersion(ORGANIZATION, 9)).resolves.toBeNull();
    await expect(repository.findActive(ORGANIZATION)).rejects.toMatchObject({
      code: 'CRYPTO.KMS_UNAVAILABLE',
    });
  });

  it('refuses every attempt to create a key', async () => {
    const repository = new ReadOnlyDataKeyRepository(providerReturning([], []));

    await expect(repository.insertAsActive()).rejects.toThrow(/not allowed to create data keys/);
  });
});
