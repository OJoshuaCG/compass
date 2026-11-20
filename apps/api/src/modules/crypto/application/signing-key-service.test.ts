import { describe, expect, it } from 'vitest';

import { DomainError } from '../../../shared/kernel/index.js';
import { NodeCryptoPrimitives } from '../infrastructure/node-crypto-primitives.js';
import { NodeSigningKeyGenerator } from '../infrastructure/node-signing-key-generator.js';
import { FakeKeyManagement } from '../testing/fake-key-management.js';
import { InMemorySigningKeyStore } from '../testing/in-memory-signing-key-store.js';
import { PlatformEnvelope } from './platform-envelope.js';
import { SigningKeyService } from './signing-key-service.js';

function setup() {
  const kms = new FakeKeyManagement();
  const store = new InMemorySigningKeyStore();
  const envelope = new PlatformEnvelope({ kms, primitives: new NodeCryptoPrimitives() });
  const service = new SigningKeyService({
    store,
    generator: new NodeSigningKeyGenerator(),
    envelope,
  });
  return { kms, store, envelope, service };
}

describe('PlatformEnvelope', () => {
  it('abre lo que selló con el mismo propósito', async () => {
    const { envelope } = setup();
    const sealed = await envelope.seal('purpose-a', new TextEncoder().encode('secret'));
    const opened = await envelope.open('purpose-a', sealed);
    expect(new TextDecoder().decode(opened)).toBe('secret');
  });

  it('no abre con otro propósito (el contexto va como AAD)', async () => {
    const { envelope } = setup();
    const sealed = await envelope.seal('purpose-a', new TextEncoder().encode('secret'));
    await expect(envelope.open('purpose-b', sealed)).rejects.toMatchObject({
      code: 'CRYPTO.DECRYPT_FAILED',
    });
  });

  it('rechaza sobres truncados, alterados o de otra versión sin lanzar otra cosa', async () => {
    const { envelope } = setup();
    const sealed = await envelope.seal('p', new TextEncoder().encode('secret'));
    const tampered = sealed.slice();
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    const wrongVersion = sealed.slice();
    wrongVersion[0] = 9;
    for (const bad of [tampered, wrongVersion, sealed.slice(0, 5), new Uint8Array(0)]) {
      await expect(envelope.open('p', bad)).rejects.toMatchObject({
        code: 'CRYPTO.DECRYPT_FAILED',
      });
    }
  });

  it('falla cerrado con CRYPTO.KMS_UNAVAILABLE si el KMS cae', async () => {
    const { envelope, kms } = setup();
    kms.available = false;
    await expect(envelope.seal('p', new Uint8Array(1))).rejects.toMatchObject({
      code: 'CRYPTO.KMS_UNAVAILABLE',
    });
  });

  it('usa una DEK distinta por sobre', async () => {
    const { envelope, kms } = setup();
    await envelope.seal('p', new Uint8Array(1));
    await envelope.seal('p', new Uint8Array(1));
    expect(kms.generateCalls).toBe(2);
  });
});

describe('SigningKeyService', () => {
  it('ensureActiveKey crea una clave una sola vez', async () => {
    const { service, store } = setup();
    await service.ensureActiveKey();
    await service.ensureActiveKey();
    expect(await store.listActive()).toHaveLength(1);
  });

  it('guarda la clave privada cifrada y nunca en claro', async () => {
    const { service, store } = setup();
    await service.ensureActiveKey();
    const [stored] = await store.listActive();
    const raw = new TextDecoder('latin1').decode(stored?.privateJwkCiphertext);
    expect(raw).not.toContain('"d"');
    expect(JSON.stringify(stored?.publicJwk)).not.toContain('"d"');
  });

  it('loadKeySet devuelve privadas con d y públicas sin d, con kid, alg y use', async () => {
    const { service } = setup();
    await service.ensureActiveKey();
    const { privateJwks, publicJwks } = await service.loadKeySet();
    expect(privateJwks).toHaveLength(1);
    expect(privateJwks[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(privateJwks[0]).toHaveProperty('d');
    expect(publicJwks[0]).not.toHaveProperty('d');
    expect(publicJwks[0]?.kid).toBe(privateJwks[0]?.kid);
  });

  it('rotate añade una clave sin retirar la anterior; la más antigua firma primero', async () => {
    const { service } = setup();
    await service.ensureActiveKey();
    const first = (await service.loadKeySet()).publicJwks[0]?.kid;
    const second = await service.rotate();
    const kids = (await service.loadKeySet()).publicJwks.map((jwk) => jwk.kid);
    expect(kids).toEqual([first, second]);
  });

  it('soporta RS256', async () => {
    const { service } = setup();
    await service.rotate('RS256');
    expect((await service.loadKeySet()).privateJwks[0]).toMatchObject({ kty: 'RSA', alg: 'RS256' });
  });

  it('se niega a retirar la última clave activa', async () => {
    const { service } = setup();
    await service.ensureActiveKey();
    const kid = (await service.loadKeySet()).publicJwks[0]?.kid as string;
    await expect(service.retire(kid)).rejects.toSatisfy(
      (e: unknown) => e instanceof DomainError && e.code === 'CRYPTO.LAST_SIGNING_KEY',
    );
  });

  it('retira una clave cuando queda otra activa', async () => {
    const { service } = setup();
    await service.ensureActiveKey();
    const first = (await service.loadKeySet()).publicJwks[0]?.kid as string;
    await service.rotate();
    expect(await service.retire(first)).toBe(true);
    expect((await service.loadKeySet()).publicJwks).toHaveLength(1);
  });

  it('listActiveKeys devuelve solo kid y algoritmo, de la más antigua a la más nueva', async () => {
    const { service } = setup();
    const first = await service.rotate('RS256');
    const second = await service.rotate('ES256');

    const summaries = await service.listActiveKeys();

    expect(summaries).toEqual([
      { kid: first, algorithm: 'RS256' },
      { kid: second, algorithm: 'ES256' },
    ]);
    // Ni la clave pública ni el sobre cifrado salen por este método: es lo que se imprime en la consola.
    for (const summary of summaries) {
      expect(Object.keys(summary).sort()).toEqual(['algorithm', 'kid']);
    }
  });

  it('un sobre copiado a otra fila (otro kid) no abre', async () => {
    const { service, store } = setup();
    await service.rotate();
    await service.rotate();
    const [one, two] = await store.listActive();
    if (one === undefined || two === undefined) throw new Error('Se esperaban dos claves');
    await store.add({ ...one, kid: two.kid, privateJwkCiphertext: one.privateJwkCiphertext });
    await expect(service.loadKeySet()).rejects.toMatchObject({ code: 'CRYPTO.DECRYPT_FAILED' });
  });
});
