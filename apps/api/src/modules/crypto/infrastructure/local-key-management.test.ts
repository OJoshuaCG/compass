import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalKeyManagement } from './local-key-management.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'iam-local-kms-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('LocalKeyManagement', () => {
  it('refuses to start when NODE_ENV=production', () => {
    expect(
      () => new LocalKeyManagement({ keyFilePath: join(dir, 'kek.key'), nodeEnv: 'production' }),
    ).toThrow(/refuses to start/);
  });

  it('creates the KEK file with 0600 permissions and reuses it', async () => {
    const path = join(dir, 'nested', 'kek.key');
    const first = new LocalKeyManagement({ keyFilePath: path, nodeEnv: 'development' });
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const generated = await first.generateDataKey({ organizationId: 'org-a' });
    const second = new LocalKeyManagement({ keyFilePath: path, nodeEnv: 'development' });
    const unwrapped = await second.decryptDataKey({
      organizationId: 'org-a',
      wrapped: generated.wrapped,
      keyRef: generated.keyRef,
    });

    expect(Buffer.from(unwrapped).equals(Buffer.from(generated.plaintext))).toBe(true);
  });

  it('never overwrites an existing KEK (exclusive create), so DEKs already wrapped stay readable', () => {
    const path = join(dir, 'kek.key');
    const existing = new Uint8Array(32).fill(7);
    writeFileSync(path, existing);

    new LocalKeyManagement({ keyFilePath: path, nodeEnv: 'development' });

    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(existing))).toBe(true);
  });

  it('rejects a KEK file with an invalid length', () => {
    const path = join(dir, 'kek.key');
    writeFileSync(path, new Uint8Array(5));

    expect(() => new LocalKeyManagement({ keyFilePath: path, nodeEnv: 'test' })).toThrow(
      /invalid length/,
    );
  });

  it('cannot unwrap a DEK for a different organization', async () => {
    const kms = new LocalKeyManagement({ keyFilePath: join(dir, 'kek.key'), nodeEnv: 'test' });
    const generated = await kms.generateDataKey({ organizationId: 'org-a' });

    await expect(
      kms.decryptDataKey({
        organizationId: 'org-b',
        wrapped: generated.wrapped,
        keyRef: generated.keyRef,
      }),
    ).rejects.toThrow();
  });

  it('rejects a tampered wrapped key and an unknown key reference', async () => {
    const kms = new LocalKeyManagement({ keyFilePath: join(dir, 'kek.key'), nodeEnv: 'test' });
    const generated = await kms.generateDataKey({ organizationId: 'org-a' });
    const tampered = new Uint8Array(generated.wrapped);
    tampered[20] = (tampered[20] ?? 0) ^ 1;

    await expect(
      kms.decryptDataKey({ organizationId: 'org-a', wrapped: tampered, keyRef: generated.keyRef }),
    ).rejects.toThrow();
    await expect(
      kms.decryptDataKey({ organizationId: 'org-a', wrapped: generated.wrapped, keyRef: 'aws:x' }),
    ).rejects.toThrow();
  });

  it('wraps a different DEK each time', async () => {
    const kms = new LocalKeyManagement({ keyFilePath: join(dir, 'kek.key'), nodeEnv: 'test' });
    const a = await kms.generateDataKey({ organizationId: 'org-a' });
    const b = await kms.generateDataKey({ organizationId: 'org-a' });
    expect(Buffer.from(a.plaintext).equals(Buffer.from(b.plaintext))).toBe(false);
  });
});
