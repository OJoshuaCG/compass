import { describe, expect, it } from 'vitest';

import { loadInboundPollConfig } from './inbound-poll-config.js';

const VALID = { DATABASE_URL_INBOUND_WORKER: 'postgres://worker@db/iam', NODE_ENV: 'test' };

describe('loadInboundPollConfig', () => {
  it('applies safe defaults and needs only the worker database', () => {
    const config = loadInboundPollConfig(VALID);

    expect(config.KMS_ADAPTER).toBe('local');
    expect(config.INBOUND_POLL_ALLOWED_PRIVATE_NETWORKS).toEqual([]);
    expect(config.INBOUND_POLL_MAX_SOURCES_PER_RUN).toBe(50);
    expect(config.INBOUND_POLL_RUN_BUDGET_SECONDS).toBe(50);
  });

  it('requires NODE_ENV so a missing variable cannot fall back to the development key store', () => {
    expect(() =>
      loadInboundPollConfig({ DATABASE_URL_INBOUND_WORKER: 'postgres://w@db/iam' }),
    ).toThrow(/NODE_ENV/);
  });

  it('does not accept the application database variable as a substitute', () => {
    expect(() =>
      loadInboundPollConfig({ DATABASE_URL: 'postgres://app@db/iam', NODE_ENV: 'test' }),
    ).toThrow(/DATABASE_URL_INBOUND_WORKER/);
  });

  it('splits the allowed private networks and drops empty entries', () => {
    const config = loadInboundPollConfig({
      ...VALID,
      INBOUND_POLL_ALLOWED_PRIVATE_NETWORKS: ' 10.1.0.0/16, ,fd00:1:2::/48 ',
    });

    expect(config.INBOUND_POLL_ALLOWED_PRIVATE_NETWORKS).toEqual(['10.1.0.0/16', 'fd00:1:2::/48']);
  });

  it('requires the AWS key and region with the aws adapter', () => {
    expect(() => loadInboundPollConfig({ ...VALID, KMS_ADAPTER: 'aws' })).toThrow(/AWS_KMS_KEY_ID/);
  });

  it('refuses the local key management in production', () => {
    expect(() => loadInboundPollConfig({ ...VALID, NODE_ENV: 'production' })).toThrow(
      /KMS_ADAPTER/,
    );
  });

  it('keeps secrets out of the error message', () => {
    const secretUrl = 'postgres://worker:s3cr3t@db/iam';
    let message = '';
    try {
      loadInboundPollConfig({
        DATABASE_URL_INBOUND_WORKER: secretUrl,
        INBOUND_POLL_RUN_BUDGET_SECONDS: '1',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).not.toContain('s3cr3t');
    expect(message).toContain('INBOUND_POLL_RUN_BUDGET_SECONDS');
  });

  it('bounds the run budget and the source cap', () => {
    expect(() =>
      loadInboundPollConfig({ ...VALID, INBOUND_POLL_MAX_SOURCES_PER_RUN: '0' }),
    ).toThrow();
    expect(() =>
      loadInboundPollConfig({ ...VALID, INBOUND_POLL_RUN_BUDGET_SECONDS: '5000' }),
    ).toThrow();
  });
});
