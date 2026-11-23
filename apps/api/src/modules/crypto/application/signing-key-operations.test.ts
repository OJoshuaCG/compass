import { describe, expect, it } from 'vitest';

import { DomainError } from '../../../shared/kernel/index.js';
import { NodeCryptoPrimitives } from '../infrastructure/node-crypto-primitives.js';
import { NodeSigningKeyGenerator } from '../infrastructure/node-signing-key-generator.js';
import { FakeKeyManagement } from '../testing/fake-key-management.js';
import { InMemorySigningKeyStore } from '../testing/in-memory-signing-key-store.js';
import { ManualClock } from '../testing/manual-clock.js';
import { PlatformEnvelope } from './platform-envelope.js';
import { SigningKeyCommandError } from './signing-key-command-error.js';
import { SigningKeyOperations, formatSigningKeyRecord } from './signing-key-operations.js';
import { SigningKeyService } from './signing-key-service.js';

const OPERATOR = 'ops-user';

function setup(operator = OPERATOR) {
  const kms = new FakeKeyManagement();
  const store = new InMemorySigningKeyStore();
  const clock = new ManualClock(new Date('2026-11-20T18:30:00.000Z'));
  const service = new SigningKeyService({
    store,
    generator: new NodeSigningKeyGenerator(),
    envelope: new PlatformEnvelope({ kms, primitives: new NodeCryptoPrimitives() }),
    actor: `os:${operator}`,
  });
  const operations = new SigningKeyOperations({ service, clock, operator });
  return { kms, store, clock, service, operations };
}

/** Los registros se pegan en un ticket de cambio: cada uno debe ser exactamente una línea de JSON. */
function parseRecordLine(line: string): Record<string, unknown> {
  expect(line).not.toMatch(/[\r\n]/);
  return JSON.parse(line) as Record<string, unknown>;
}

describe('SigningKeyOperations.rotate', () => {
  it('publica una clave nueva sin retirar la anterior y deja un registro con quién y cuándo', async () => {
    const { service, operations, clock } = setup();
    await service.ensureActiveKey();
    const before = (await service.listActiveKeys())[0];
    if (before === undefined) throw new Error('Se esperaba la clave inicial');

    const record = await operations.rotate();

    const active = await service.listActiveKeys();
    expect(active.map((key) => key.kid)).toEqual([before.kid, record.kid]);
    expect(record).toEqual({
      action: 'rotate',
      kid: record.kid,
      algorithm: 'ES256',
      occurredAt: clock.now(),
      operator: OPERATOR,
    });
    expect(parseRecordLine(formatSigningKeyRecord(record))).toEqual({
      event: 'oidc_signing_key',
      action: 'rotate',
      kid: record.kid,
      alg: 'ES256',
      at: '2026-11-20T18:30:00.000Z',
      os_user: OPERATOR,
    });
  });

  it('respeta el algoritmo pedido', async () => {
    const { operations } = setup();
    const record = await operations.rotate('RS256');
    expect(record.algorithm).toBe('RS256');
  });

  it('el registro nunca contiene material de la clave privada', async () => {
    const { service, operations } = setup();
    const record = await operations.rotate();
    const line = formatSigningKeyRecord(record);

    const keySet = await service.loadKeySet();
    const privateJwk = keySet.privateJwks[0];
    if (privateJwk === undefined) throw new Error('Se esperaba una clave privada');
    // Todo valor de texto de la JWK privada que no sea metadato público (el componente `d`, entre otros).
    const publicValues = new Set(Object.values(keySet.publicJwks[0] ?? {}));
    const secretValues = Object.values(privateJwk).filter(
      (value): value is string => typeof value === 'string' && !publicValues.has(value),
    );
    expect(secretValues.length).toBeGreaterThan(0);
    for (const secretValue of secretValues) {
      expect(line).not.toContain(secretValue);
    }
  });

  it('si el KMS cae no hay registro: no se declara una acción que no ocurrió', async () => {
    const { kms, service, operations } = setup();
    await service.ensureActiveKey();
    kms.available = false;

    await expect(operations.rotate()).rejects.toMatchObject({ code: 'CRYPTO.KMS_UNAVAILABLE' });

    kms.available = true;
    expect(await service.listActiveKeys()).toHaveLength(1);
  });
});

describe('SigningKeyOperations.retire', () => {
  it('retira la clave pedida y registra su algoritmo', async () => {
    const { service, operations } = setup();
    const oldKid = await service.rotate('RS256');
    const newKid = await service.rotate('ES256');

    const record = await operations.retire(oldKid);

    expect(record).toMatchObject({ action: 'retire', kid: oldKid, algorithm: 'RS256' });
    expect((await service.listActiveKeys()).map((key) => key.kid)).toEqual([newKid]);
  });

  it('un kid que no está activo falla sin retirar nada y sin registro', async () => {
    const { service, operations } = setup();
    await service.rotate();
    await service.rotate();

    await expect(operations.retire('no-such-kid')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof SigningKeyCommandError && error.code === 'SIGNING_KEY_NOT_FOUND',
    );
    expect(await service.listActiveKeys()).toHaveLength(2);
  });

  it('se niega a retirar la última clave activa', async () => {
    const { service, operations } = setup();
    const onlyKid = await service.rotate();

    await expect(operations.retire(onlyKid)).rejects.toSatisfy(
      (error: unknown) => error instanceof DomainError && error.code === 'CRYPTO.LAST_SIGNING_KEY',
    );
    expect(await service.listActiveKeys()).toHaveLength(1);
  });

  it('si otra persona retiró la clave entre la consulta y el retiro, no la declara como retirada por esta ejecución', async () => {
    const { service, store, operations } = setup();
    const oldKid = await service.rotate();
    await service.rotate();
    // Simula la carrera: el almacén ya no tiene la clave cuando se intenta retirar.
    const originalRetire = store.retire.bind(store);
    store.retire = async (kid: string, actor: string): Promise<boolean> => {
      await originalRetire(kid, actor);
      return false;
    };

    await expect(operations.retire(oldKid)).rejects.toMatchObject({
      code: 'SIGNING_KEY_NOT_FOUND',
    });
  });
});

describe('rotación completa (condición L25 del seguimiento OIDC)', () => {
  it('tras rotate y retire, la clave que firma es la publicada en el JWKS', async () => {
    const { service, operations } = setup();
    const oldKid = await service.rotate();
    const rotated = await operations.rotate();
    // Con las dos activas, la más antigua sigue firmando y ambas se publican.
    const duringWindow = await service.loadKeySet();
    expect(duringWindow.privateJwks[0]?.kid).toBe(oldKid);
    expect(duringWindow.publicJwks.map((jwk) => jwk.kid)).toEqual([oldKid, rotated.kid]);

    await operations.retire(oldKid);

    const afterRetire = await service.loadKeySet();
    expect(afterRetire.privateJwks.map((jwk) => jwk.kid)).toEqual([rotated.kid]);
    expect(afterRetire.publicJwks.map((jwk) => jwk.kid)).toEqual([rotated.kid]);
  });
});

describe('SigningKeyOperations.list', () => {
  it('devuelve un registro por clave activa con solo datos públicos', async () => {
    const { service, operations } = setup();
    const first = await service.rotate('RS256');
    const second = await service.rotate('ES256');

    const records = await operations.list();

    expect(records.map((record) => [record.action, record.kid, record.algorithm])).toEqual([
      ['list', first, 'RS256'],
      ['list', second, 'ES256'],
    ]);
  });
});

describe('formatSigningKeyRecord', () => {
  it('un nombre de usuario con saltos de línea no puede fabricar registros falsos', () => {
    const { clock } = setup();
    const line = formatSigningKeyRecord({
      action: 'rotate',
      kid: 'abc',
      algorithm: 'ES256',
      occurredAt: clock.now(),
      operator: 'ops\n{"action":"retire","kid":"victim"}',
    });

    expect(parseRecordLine(line).action).toBe('rotate');
  });
});
