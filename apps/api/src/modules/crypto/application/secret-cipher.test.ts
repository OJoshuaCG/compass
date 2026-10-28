import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import { NodeCryptoPrimitives } from '../infrastructure/node-crypto-primitives.js';
import { FakeKeyManagement } from '../testing/fake-key-management.js';
import { InMemoryDataKeyRepository } from '../testing/in-memory-data-key-repository.js';
import { ManualClock } from '../testing/manual-clock.js';
import { DataKeyResolver } from './data-key-resolver.js';
import { DekCache } from './dek-cache.js';
import { SecretCipher } from './secret-cipher.js';
import type { EncryptedSecret, SecretContext } from '../domain/secret-context.js';

const ORG_A = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const ORG_B = asOrganizationId('0198bbbb-0000-7000-8000-000000000002');
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const read = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function setup() {
  const clock = new ManualClock();
  const kms = new FakeKeyManagement();
  const repository = new InMemoryDataKeyRepository();
  const primitives = new NodeCryptoPrimitives();
  const cache = new DekCache({ clock });
  const keys = new DataKeyResolver({
    repository,
    kms,
    cache,
    clock,
    independently: (fn) => fn(),
  });
  const cipher = new SecretCipher({ keys, primitives });
  return { clock, kms, repository, keys, cipher, cache };
}

const context = (overrides: Partial<SecretContext> = {}): SecretContext => ({
  organizationId: ORG_A,
  resourceId: 'cred-1',
  field: 'password',
  version: 1,
  ...overrides,
});

async function seal(
  cipher: SecretCipher,
  ctx: SecretContext,
  value: string,
): Promise<EncryptedSecret> {
  const result = await cipher.encrypt(ctx, text(value));
  if (!result.ok) throw new Error('encrypt failed');
  return result.value;
}

describe('SecretCipher round trip', () => {
  it('decrypts what it encrypted', async () => {
    const { cipher } = setup();
    const sealed = await seal(cipher, context(), 'hunter2');

    const opened = await cipher.decrypt(context(), sealed);

    expect(opened.ok && read(opened.value)).toBe('hunter2');
  });

  it('records the DEK version and a 12-byte nonce, and never stores plaintext', async () => {
    const { cipher } = setup();
    const sealed = await seal(cipher, context(), 'hunter2');

    expect(sealed.dekVersion).toBe(1);
    expect(sealed.nonce).toHaveLength(12);
    expect(Buffer.from(sealed.ciphertext).includes(Buffer.from('hunter2'))).toBe(false);
  });

  it('never reuses a nonce across many encryptions of the same value', async () => {
    const { cipher } = setup();
    const nonces = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const sealed = await seal(cipher, context(), 'same');
      nonces.add(Buffer.from(sealed.nonce).toString('hex'));
    }
    expect(nonces.size).toBe(500);
  });
});

describe('SecretCipher AAD binding (all must fail to decrypt)', () => {
  it.each([
    ['another resource', { resourceId: 'cred-2' }],
    ['another field', { field: 'totp_uri' }],
    ['another secret version', { version: 2 }],
  ])('rejects the ciphertext moved to %s', async (_label, override) => {
    const { cipher } = setup();
    const sealed = await seal(cipher, context(), 'hunter2');

    const opened = await cipher.decrypt(context(override), sealed);

    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.error.code).toBe('CRYPTO.DECRYPT_FAILED');
  });

  it('rejects the ciphertext presented as another organization', async () => {
    const { cipher } = setup();
    const sealed = await seal(cipher, context(), 'hunter2');
    // Misma versión de DEK en la otra organización: el KMS ya rechaza abrir la DEK ajena.
    await seal(cipher, context({ organizationId: ORG_B }), 'other');

    const opened = await cipher.decrypt(context({ organizationId: ORG_B }), sealed);

    expect(opened.ok).toBe(false);
  });

  it('returns a generic error for a flipped bit, truncation and a wrong nonce', async () => {
    const { cipher } = setup();
    const sealed = await seal(cipher, context(), 'hunter2');
    const flipped = new Uint8Array(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;

    const attempts = [
      { ...sealed, ciphertext: flipped },
      { ...sealed, ciphertext: sealed.ciphertext.subarray(0, 5) },
      { ...sealed, nonce: new Uint8Array(12).fill(1) },
      { ...sealed, nonce: new Uint8Array(4) },
    ];
    for (const attempt of attempts) {
      const opened = await cipher.decrypt(context(), attempt);
      expect(!opened.ok && opened.error.code).toBe('CRYPTO.DECRYPT_FAILED');
    }
  });
});

describe('DEK rotation', () => {
  it('keeps old ciphertexts readable while new ones use the new version', async () => {
    const { cipher, keys, repository } = setup();
    const old = await seal(cipher, context(), 'before');

    const version = await keys.rotate(ORG_A);

    expect(version).toBe(2);
    expect(repository.all(ORG_A).filter((r) => r.status === 'active')).toHaveLength(1);
    const stillReadable = await cipher.decrypt(context(), old);
    expect(stillReadable.ok && read(stillReadable.value)).toBe('before');
    const next = await seal(cipher, context({ resourceId: 'cred-9' }), 'after');
    expect(next.dekVersion).toBe(2);
  });

  it('reports an unknown DEK version as a typed error', async () => {
    const { cipher } = setup();
    const sealed = await seal(cipher, context(), 'x');

    const opened = await cipher.decrypt(context(), { ...sealed, dekVersion: 99 });

    expect(!opened.ok && opened.error.code).toBe('CRYPTO.UNKNOWN_DEK_VERSION');
  });

  it('creates the first DEK lazily and survives concurrent first use', async () => {
    const { cipher, repository } = setup();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        cipher.encrypt(context({ resourceId: `c${String(i)}` }), text('v')),
      ),
    );

    expect(results.every((r) => r.ok)).toBe(true);
    // Todas las instancias terminan usando la misma versión activa.
    expect(repository.all(ORG_A).filter((r) => r.status === 'active')).toHaveLength(1);
  });
});

describe('KMS outage (fail closed)', () => {
  it('keeps serving cached DEKs until the TTL, then fails closed', async () => {
    const { cipher, kms, clock } = setup();
    const sealed = await seal(cipher, context(), 'hunter2');
    kms.available = false;

    const during = await cipher.decrypt(context(), sealed);
    expect(during.ok).toBe(true);

    clock.advance(10 * 60 * 1000);
    const after = await cipher.decrypt(context(), sealed);
    expect(!after.ok && after.error.code).toBe('CRYPTO.KMS_UNAVAILABLE');
  });

  it('does not leak the underlying KMS error in the message', async () => {
    const { cipher, kms } = setup();
    kms.available = false;

    const sealed = await cipher.encrypt(context(), text('x'));

    expect(!sealed.ok && sealed.error.message).toBe('Key management service is unavailable');
  });
});

describe('blind index', () => {
  it('is deterministic and hex-encoded', async () => {
    const { cipher } = setup();
    const a = await cipher.blindIndex(ORG_A, 'platform-username', '@marca_mx');
    const b = await cipher.blindIndex(ORG_A, 'platform-username', '@marca_mx');

    expect(a.ok && b.ok && a.value.index).toBe(b.ok ? b.value.index : '');
    expect(a.ok && a.value.index).toMatch(/^[0-9a-f]{64}$/);
    expect(a.ok && a.value.dekVersion).toBe(1);
  });

  it('separates purposes, organizations and values', async () => {
    const { cipher } = setup();
    const base = await cipher.blindIndex(ORG_A, 'platform-username', 'x');
    const otherPurpose = await cipher.blindIndex(ORG_A, 'password-fingerprint', 'x');
    const otherOrg = await cipher.blindIndex(ORG_B, 'platform-username', 'x');
    const otherValue = await cipher.blindIndex(ORG_A, 'platform-username', 'y');

    const values = [base, otherPurpose, otherOrg, otherValue].map((r) =>
      r.ok ? r.value.index : '',
    );
    expect(new Set(values).size).toBe(4);
  });

  it('never contains the plaintext value', async () => {
    const { cipher } = setup();
    const result = await cipher.blindIndex(ORG_A, 'platform-username', 'supersecret');
    expect(result.ok && result.value.index.includes('supersecret')).toBe(false);
  });
});

describe('reseal (DEK rotation, ADR 0040)', () => {
  it('returns null when the secret already uses the active version', async () => {
    const { cipher } = setup();
    const sealed = await seal(cipher, context(), 'hunter2');

    const result = await cipher.reseal(context(), sealed);

    expect(result.ok && result.value).toBeNull();
  });

  it('moves a secret to the active version with a new nonce, keeping the same plaintext', async () => {
    const { cipher, keys } = setup();
    const old = await seal(cipher, context(), 'hunter2');
    await keys.rotate(ORG_A);

    const resealed = await cipher.reseal(context(), old);

    expect(resealed.ok).toBe(true);
    if (!resealed.ok || resealed.value === null) throw new Error('expected a resealed secret');
    expect(resealed.value.dekVersion).toBe(2);
    expect(resealed.value.nonce).not.toEqual(old.nonce);
    const opened = await cipher.decrypt(context(), resealed.value);
    expect(opened.ok && read(opened.value)).toBe('hunter2');
  });

  it('fails without producing a secret when the stored one cannot be opened', async () => {
    const { cipher, keys } = setup();
    const old = await seal(cipher, context(), 'hunter2');
    await keys.rotate(ORG_A);
    const tampered = { ...old, ciphertext: old.ciphertext.map((byte) => byte ^ 0xff) };

    const result = await cipher.reseal(context(), tampered);

    expect(result.ok).toBe(false);
  });

  it('does not reseal under a different context (the AAD still binds the secret)', async () => {
    const { cipher, keys } = setup();
    const old = await seal(cipher, context(), 'hunter2');
    await keys.rotate(ORG_A);

    const result = await cipher.reseal(context({ resourceId: 'cred-2' }), old);

    expect(result.ok).toBe(false);
  });
});
