import { describe, expect, it, vi } from 'vitest';

import { AwsKeyManagement } from '../modules/crypto/index.js';
import type { KeyManagementPort } from '../modules/crypto/index.js';
import { verifyKeyManagementAccess } from './key-management.js';

describe('verifyKeyManagementAccess', () => {
  it('does nothing for adapters without permissions to verify (local KMS)', async () => {
    const generateDataKey = vi.fn();
    const local: KeyManagementPort = { generateDataKey, decryptDataKey: vi.fn() };

    await expect(verifyKeyManagementAccess(local)).resolves.toBeUndefined();
    expect(generateDataKey).not.toHaveBeenCalled();
  });

  it('hides the AWS detail when the probe fails', async () => {
    const aws = new AwsKeyManagement({ keyId: 'alias/iam', region: 'us-east-1' });
    vi.spyOn(aws, 'verifyAccess').mockRejectedValue(new Error('AccessDenied arn:aws:kms:secret'));

    await expect(verifyKeyManagementAccess(aws)).rejects.toThrow('KMS access check failed');
    await expect(verifyKeyManagementAccess(aws)).rejects.not.toThrow(/arn:aws/);
  });

  it('passes when the probe succeeds', async () => {
    const aws = new AwsKeyManagement({ keyId: 'alias/iam', region: 'us-east-1' });
    const probe = vi.spyOn(aws, 'verifyAccess').mockResolvedValue(undefined);

    await expect(verifyKeyManagementAccess(aws)).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledOnce();
  });
});
