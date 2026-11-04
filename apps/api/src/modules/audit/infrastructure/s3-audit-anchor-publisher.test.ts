import type { PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import {
  AuditAnchorPublishError,
  S3AuditAnchorPublisher,
  createAnchorOperationsOn,
} from './s3-audit-anchor-publisher.js';
import type {
  AuditAnchorObjectOperations,
  AuditAnchorS3Sender,
} from './s3-audit-anchor-publisher.js';

const BUCKET = 'compass-audit-anchors';
const MANIFEST = { objectKey: 'audit-anchors/org-1/000000000001.json', body: '{"format":"x"}' };
const RETAIN_UNTIL = new Date('2028-01-01T00:00:00.000Z');
const PUBLISHER_CREDENTIALS = {
  endpoint: 'https://s3.example.test',
  region: 'test-region-1',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
};

describe('createAnchorOperationsOn', () => {
  it('writes the manifest with compliance-mode Object Lock until the retention date', async () => {
    const sent: { command: PutObjectCommand; hasAbortSignal: boolean }[] = [];
    const sender: AuditAnchorS3Sender = {
      send: (command, options) => {
        sent.push({ command, hasAbortSignal: options.abortSignal instanceof AbortSignal });
        return Promise.resolve({});
      },
    };

    await createAnchorOperationsOn(sender).putObject({
      bucket: BUCKET,
      key: MANIFEST.objectKey,
      body: MANIFEST.body,
      retainUntil: RETAIN_UNTIL,
      abortSignal: new AbortController().signal,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.hasAbortSignal).toBe(true);
    expect(sent[0]?.command.input).toEqual({
      Bucket: BUCKET,
      Key: MANIFEST.objectKey,
      Body: MANIFEST.body,
      ContentType: 'application/json',
      ObjectLockMode: 'COMPLIANCE',
      ObjectLockRetainUntilDate: RETAIN_UNTIL,
    });
  });
});

describe('S3AuditAnchorPublisher', () => {
  it('publishes to the configured bucket with a timeout signal', async () => {
    const calls: Parameters<AuditAnchorObjectOperations['putObject']>[0][] = [];
    const publisher = new S3AuditAnchorPublisher({
      ...PUBLISHER_CREDENTIALS,
      bucket: BUCKET,
      operations: {
        putObject: (input) => {
          calls.push(input);
          return Promise.resolve();
        },
      },
    });

    await publisher.publish(MANIFEST, RETAIN_UNTIL);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.bucket).toBe(BUCKET);
    expect(calls[0]?.key).toBe(MANIFEST.objectKey);
    expect(calls[0]?.body).toBe(MANIFEST.body);
    expect(calls[0]?.retainUntil).toEqual(RETAIN_UNTIL);
    expect(calls[0]?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('reports only the SDK error name, never the service detail', async () => {
    const serviceFailure = Object.assign(
      new Error('Access denied for key test-access-key on bucket'),
      {
        name: 'AccessDenied',
      },
    );
    const publisher = new S3AuditAnchorPublisher({
      ...PUBLISHER_CREDENTIALS,
      bucket: BUCKET,
      operations: { putObject: () => Promise.reject(serviceFailure) },
    });

    const failure = await publisher.publish(MANIFEST, RETAIN_UNTIL).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AuditAnchorPublishError);
    expect((failure as AuditAnchorPublishError).code).toBe('AccessDenied');
    expect((failure as Error).message).not.toContain('test-access-key');
    expect((failure as Error).message).not.toContain('bucket');
  });

  it('refuses to start without a bucket', () => {
    expect(
      () =>
        new S3AuditAnchorPublisher({
          ...PUBLISHER_CREDENTIALS,
          bucket: '',
          operations: { putObject: () => Promise.resolve() },
        }),
    ).toThrow(/requires a bucket/);
  });
});
