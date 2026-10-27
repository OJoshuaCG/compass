import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import { FakeKeyManagement } from '../testing/fake-key-management.js';
import { InMemoryDataKeyRepository } from '../testing/in-memory-data-key-repository.js';
import { ManualClock } from '../testing/manual-clock.js';
import { DataKeyResolver } from './data-key-resolver.js';
import { DekCache } from './dek-cache.js';

const ORG = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');

function setup() {
  const clock = new ManualClock();
  const kms = new FakeKeyManagement();
  const repository = new InMemoryDataKeyRepository();
  const independent = { calls: 0 };
  const keys = new DataKeyResolver({
    repository,
    kms,
    cache: new DekCache({ clock }),
    clock,
    activeVersionTtlMs: 60_000,
    independently: (fn) => {
      independent.calls += 1;
      return fn();
    },
  });
  return { clock, kms, repository, keys, independent };
}

describe('DataKeyResolver', () => {
  it('creates version 1 on first use and reuses it afterwards', async () => {
    const { keys, kms, repository } = setup();

    const v1 = await keys.withActiveKey(ORG, (_key, version) => version);
    const v2 = await keys.withActiveKey(ORG, (_key, version) => version);

    expect(v1).toBe(1);
    expect(v2).toBe(1);
    expect(kms.generateCalls).toBe(1);
    expect(repository.all(ORG)).toHaveLength(1);
  });

  it('creates and rotates DEKs in an independent transaction (survives a caller rollback)', async () => {
    const { keys, independent } = setup();

    await keys.withActiveKey(ORG, () => undefined);
    expect(independent.calls).toBe(1);

    await keys.rotate(ORG);
    expect(independent.calls).toBe(2);

    // Leer una versión ya existente no abre transacciones independientes.
    await keys.withActiveKey(ORG, () => undefined);
    expect(independent.calls).toBe(2);
  });

  it('only calls the KMS to open a DEK once while it is cached', async () => {
    const { keys, kms } = setup();

    for (let i = 0; i < 20; i += 1) await keys.withActiveKey(ORG, () => undefined);

    expect(kms.decryptCalls).toBe(1);
  });

  it('retires the previous version on rotation and keeps it readable', async () => {
    const { keys, repository } = setup();
    await keys.withActiveKey(ORG, () => undefined);

    const version = await keys.rotate(ORG);

    expect(version).toBe(2);
    const statuses = repository.all(ORG).map((r) => [r.version, r.status]);
    expect(statuses).toEqual([
      [1, 'retired'],
      [2, 'active'],
    ]);
    await expect(keys.withKey(ORG, 1, () => 'ok')).resolves.toBe('ok');
  });

  it('sees a rotated version immediately in the instance that rotated', async () => {
    const { keys } = setup();
    await keys.withActiveKey(ORG, () => undefined);

    await keys.rotate(ORG);

    expect(await keys.withActiveKey(ORG, (_key, version) => version)).toBe(2);
  });

  it('adopts a version rotated by another instance after the pointer TTL', async () => {
    const { keys, repository, clock } = setup();
    expect(await keys.withActiveKey(ORG, (_key, version) => version)).toBe(1);
    // Otra instancia rota directamente en el repositorio compartido.
    const v1 = repository.all(ORG)[0];
    if (v1 === undefined) throw new Error('missing v1');
    await repository.insertAsActive({ ...v1, version: 2 });

    expect(await keys.withActiveKey(ORG, (_key, version) => version)).toBe(1);
    clock.advance(61_000);
    expect(await keys.withActiveKey(ORG, (_key, version) => version)).toBe(2);
  });

  it('maps KMS failures to CRYPTO.KMS_UNAVAILABLE without leaking the cause message', async () => {
    const { keys, kms } = setup();
    kms.available = false;

    await expect(keys.withActiveKey(ORG, () => undefined)).rejects.toMatchObject({
      code: 'CRYPTO.KMS_UNAVAILABLE',
      message: 'Key management service is unavailable',
    });
  });

  it('refuses a DEK that was wrapped for another organization', async () => {
    const { keys, repository } = setup();
    await keys.withActiveKey(ORG, () => undefined);
    const stolen = repository.all(ORG)[0];
    if (stolen === undefined) throw new Error('missing');
    const other = asOrganizationId('0198bbbb-0000-7000-8000-000000000002');
    await repository.insertAsActive({ ...stolen, organizationId: other, version: 1 });

    await expect(keys.withKey(other, 1, () => undefined)).rejects.toMatchObject({
      code: 'CRYPTO.KMS_UNAVAILABLE',
    });
  });
});
