import { describe, expect, it } from 'vitest';

import {
  AwsKeyManagement,
  AWS_KMS_REQUEST_TIMEOUT_MS,
  createOperationsOn,
} from './aws-key-management.js';
import type { AwsGeneratedDataKey, AwsKmsOperations, AwsKmsSender } from './aws-key-management.js';

const CONFIGURED_KEY_ID = 'alias/iam-platform';
const RESOLVED_KEY_ARN = 'arn:aws:kms:us-east-1:111122223333:key/resolved-key';
const ORGANIZATION_ID = 'org-1';

interface RecordedCall {
  readonly keyId: string;
  readonly encryptionContext: Readonly<Record<string, string>>;
  readonly hasAbortSignal: boolean;
}

function dataKeyOf(length: number): Uint8Array {
  return new Uint8Array(length).fill(7);
}

function setup(
  overrides: {
    readonly generated?: Partial<AwsGeneratedDataKey>;
    readonly decrypted?: Uint8Array | undefined;
    readonly failWith?: Error;
  } = {},
) {
  const generateCalls: RecordedCall[] = [];
  const decryptCalls: (RecordedCall & { readonly ciphertextBlob: Uint8Array })[] = [];
  const operations: AwsKmsOperations = {
    generateDataKey: (input) => {
      generateCalls.push({
        keyId: input.keyId,
        encryptionContext: input.encryptionContext,
        hasAbortSignal: input.abortSignal instanceof AbortSignal,
      });
      if (overrides.failWith !== undefined) return Promise.reject(overrides.failWith);
      return Promise.resolve({
        plaintext: dataKeyOf(32),
        ciphertextBlob: new Uint8Array([1, 2, 3]),
        keyId: RESOLVED_KEY_ARN,
        ...overrides.generated,
      });
    },
    decrypt: (input) => {
      decryptCalls.push({
        keyId: input.keyId,
        encryptionContext: input.encryptionContext,
        hasAbortSignal: input.abortSignal instanceof AbortSignal,
        ciphertextBlob: input.ciphertextBlob,
      });
      if (overrides.failWith !== undefined) return Promise.reject(overrides.failWith);
      return Promise.resolve('decrypted' in overrides ? overrides.decrypted : dataKeyOf(32));
    },
  };
  const keyManagement = new AwsKeyManagement({
    keyId: CONFIGURED_KEY_ID,
    region: 'us-east-1',
    operations,
  });
  return { keyManagement, generateCalls, decryptCalls };
}

describe('AwsKeyManagement.generateDataKey', () => {
  it('asks KMS for a data key bound to the organization and returns the resolved key ARN', async () => {
    const { keyManagement, generateCalls } = setup();

    const generated = await keyManagement.generateDataKey({ organizationId: ORGANIZATION_ID });

    expect(generated.plaintext).toHaveLength(32);
    expect(Array.from(generated.wrapped)).toEqual([1, 2, 3]);
    expect(generated.keyRef).toBe(RESOLVED_KEY_ARN);
    expect(generateCalls).toEqual([
      {
        keyId: CONFIGURED_KEY_ID,
        encryptionContext: { organization_id: ORGANIZATION_ID },
        hasAbortSignal: true,
      },
    ]);
  });

  it('rejects a response whose data key is not 32 bytes and wipes it', async () => {
    const shortKey = dataKeyOf(16);
    const { keyManagement } = setup({ generated: { plaintext: shortKey } });

    await expect(
      keyManagement.generateDataKey({ organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow('invalid length');
    expect(Array.from(shortKey).every((byte) => byte === 0)).toBe(true);
  });

  it.each([
    ['plaintext', { plaintext: undefined }],
    ['wrapped key', { ciphertextBlob: undefined }],
    ['empty wrapped key', { ciphertextBlob: new Uint8Array(0) }],
    ['key id', { keyId: undefined }],
    ['empty key id', { keyId: '' }],
  ])('rejects a response without %s', async (_label, generated) => {
    const { keyManagement } = setup({ generated });

    await expect(
      keyManagement.generateDataKey({ organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow('incomplete');
  });

  it('wipes the plaintext when the rest of the response is incomplete', async () => {
    const plaintext = dataKeyOf(32);
    const { keyManagement } = setup({
      generated: { plaintext, ciphertextBlob: undefined },
    });

    await expect(
      keyManagement.generateDataKey({ organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow('incomplete');
    expect(Array.from(plaintext).every((byte) => byte === 0)).toBe(true);
  });

  it('hides the AWS error detail', async () => {
    const { keyManagement } = setup({
      failWith: new Error('AccessDenied for arn:aws:kms:us-east-1:111122223333:key/secret'),
    });

    const failure = await keyManagement
      .generateDataKey({ organizationId: ORGANIZATION_ID })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Data key could not be generated');
    expect((failure as Error).message).not.toContain('arn:aws');
  });
});

describe('AwsKeyManagement.decryptDataKey', () => {
  it('opens the data key with the stored key ARN and the organization context', async () => {
    const { keyManagement, decryptCalls } = setup();
    const wrapped = new Uint8Array([9, 9, 9]);

    const plaintext = await keyManagement.decryptDataKey({
      organizationId: ORGANIZATION_ID,
      wrapped,
      keyRef: RESOLVED_KEY_ARN,
    });

    expect(plaintext).toHaveLength(32);
    expect(decryptCalls).toHaveLength(1);
    expect(decryptCalls[0]).toMatchObject({
      keyId: RESOLVED_KEY_ARN,
      encryptionContext: { organization_id: ORGANIZATION_ID },
      hasAbortSignal: true,
    });
    expect(Array.from(decryptCalls[0]?.ciphertextBlob ?? [])).toEqual([9, 9, 9]);
  });

  it('rejects an empty key reference without calling KMS', async () => {
    const { keyManagement, decryptCalls } = setup();

    await expect(
      keyManagement.decryptDataKey({
        organizationId: ORGANIZATION_ID,
        wrapped: new Uint8Array([1]),
        keyRef: '',
      }),
    ).rejects.toThrow('Unknown key reference');
    expect(decryptCalls).toHaveLength(0);
  });

  it('rejects when KMS returns no plaintext', async () => {
    const { keyManagement } = setup({ decrypted: undefined });

    await expect(
      keyManagement.decryptDataKey({
        organizationId: ORGANIZATION_ID,
        wrapped: new Uint8Array([1]),
        keyRef: RESOLVED_KEY_ARN,
      }),
    ).rejects.toThrow('could not be unwrapped');
  });

  it('rejects and wipes a plaintext that is not 32 bytes', async () => {
    const shortKey = dataKeyOf(31);
    const { keyManagement } = setup({ decrypted: shortKey });

    await expect(
      keyManagement.decryptDataKey({
        organizationId: ORGANIZATION_ID,
        wrapped: new Uint8Array([1]),
        keyRef: RESOLVED_KEY_ARN,
      }),
    ).rejects.toThrow('could not be unwrapped');
    expect(Array.from(shortKey).every((byte) => byte === 0)).toBe(true);
  });

  it('hides the AWS error detail, for example a context mismatch', async () => {
    const { keyManagement } = setup({
      failWith: new Error('InvalidCiphertextException: context mismatch for org-1'),
    });

    const failure = await keyManagement
      .decryptDataKey({
        organizationId: ORGANIZATION_ID,
        wrapped: new Uint8Array([1]),
        keyRef: RESOLVED_KEY_ARN,
      })
      .catch((error: unknown) => error);

    expect((failure as Error).message).toBe('Data key could not be unwrapped');
  });
});

describe('AwsKeyManagement construction', () => {
  it('refuses an empty key id', () => {
    const unusedOperations: AwsKmsOperations = {
      generateDataKey: () => Promise.reject(new Error('not expected')),
      decrypt: () => Promise.reject(new Error('not expected')),
    };

    expect(
      () => new AwsKeyManagement({ keyId: '', region: 'us-east-1', operations: unusedOperations }),
    ).toThrow('requires a KMS key id');
  });

  it('uses a bounded request timeout by default', () => {
    expect(AWS_KMS_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(AWS_KMS_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('aborts the KMS call once the configured timeout elapses', async () => {
    let capturedSignal: AbortSignal | undefined;
    const operations: AwsKmsOperations = {
      generateDataKey: (input) => {
        capturedSignal = input.abortSignal;
        return Promise.reject(new Error('aborted'));
      },
      decrypt: () => Promise.reject(new Error('not expected')),
    };
    const keyManagement = new AwsKeyManagement({
      keyId: CONFIGURED_KEY_ID,
      region: 'us-east-1',
      operations,
      requestTimeoutMs: 20,
    });

    await keyManagement.generateDataKey({ organizationId: ORGANIZATION_ID }).catch(() => undefined);
    expect(capturedSignal?.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe('createOperationsOn (SDK command mapping)', () => {
  it('sends GenerateDataKey with AES_256, the key id and the organization context', async () => {
    const sent: { input: unknown; abortSignal: AbortSignal }[] = [];
    const sender: AwsKmsSender = {
      send: (command, options) => {
        sent.push({ input: command.input, abortSignal: options.abortSignal });
        return Promise.resolve({
          Plaintext: dataKeyOf(32),
          CiphertextBlob: new Uint8Array([4]),
          KeyId: RESOLVED_KEY_ARN,
        });
      },
    };
    const signal = AbortSignal.timeout(1_000);

    const result = await createOperationsOn(sender).generateDataKey({
      keyId: CONFIGURED_KEY_ID,
      encryptionContext: { organization_id: ORGANIZATION_ID },
      abortSignal: signal,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.input).toEqual({
      KeyId: CONFIGURED_KEY_ID,
      KeySpec: 'AES_256',
      EncryptionContext: { organization_id: ORGANIZATION_ID },
    });
    expect(sent[0]?.abortSignal).toBe(signal);
    expect(result.keyId).toBe(RESOLVED_KEY_ARN);
  });

  it('sends Decrypt with the stored key, the blob and the organization context', async () => {
    const sent: { input: unknown; abortSignal: AbortSignal }[] = [];
    const sender: AwsKmsSender = {
      send: (command, options) => {
        sent.push({ input: command.input, abortSignal: options.abortSignal });
        return Promise.resolve({ Plaintext: dataKeyOf(32) });
      },
    };
    const signal = AbortSignal.timeout(1_000);

    const plaintext = await createOperationsOn(sender).decrypt({
      keyId: RESOLVED_KEY_ARN,
      ciphertextBlob: new Uint8Array([9]),
      encryptionContext: { organization_id: ORGANIZATION_ID },
      abortSignal: signal,
    });

    expect(plaintext).toHaveLength(32);
    expect(sent[0]?.input).toEqual({
      KeyId: RESOLVED_KEY_ARN,
      CiphertextBlob: new Uint8Array([9]),
      EncryptionContext: { organization_id: ORGANIZATION_ID },
    });
    expect(sent[0]?.abortSignal).toBe(signal);
  });
});
