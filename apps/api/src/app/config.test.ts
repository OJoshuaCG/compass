import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    expect(loadConfig({})).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('coerces PORT from a string', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('refuses to start with an invalid value and does not echo it', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging-secret-value' })).toThrow(/NODE_ENV/);
    try {
      loadConfig({ NODE_ENV: 'staging-secret-value' });
    } catch (error) {
      expect(String(error)).not.toContain('staging-secret-value');
    }
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
  });

  describe('TRUST_PROXY', () => {
    it('trusts no proxy by default', () => {
      expect(loadConfig({}).TRUST_PROXY).toBe(false);
    });

    it('accepts true, a number of hops or a list of addresses and ranges', () => {
      expect(loadConfig({ TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
      expect(loadConfig({ TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
      expect(loadConfig({ TRUST_PROXY: '10.0.0.0/8,192.168.1.10' }).TRUST_PROXY).toEqual([
        '10.0.0.0/8',
        '192.168.1.10',
      ]);
    });

    it('refuses to start with an invalid value and does not echo it', () => {
      expect(() => loadConfig({ TRUST_PROXY: '0.0.0.0/0' })).toThrow(/TRUST_PROXY/);
      let message = '';
      try {
        loadConfig({ TRUST_PROXY: '10.99.99.99/abc' });
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('TRUST_PROXY');
      expect(message).not.toContain('10.99.99.99');
    });
  });

  describe('key management', () => {
    const completeSmtp = {
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'mail.example.com',
      MAIL_FROM: 'IAM <no-reply@example.com>',
    };

    it('uses the local adapter by default outside production', () => {
      expect(loadConfig({}).KMS_ADAPTER).toBe('local');
    });

    it('does not start in production with the local adapter, even with a valid mail setup', () => {
      expect(() => loadConfig({ NODE_ENV: 'production', ...completeSmtp })).toThrow(/KMS_ADAPTER/);
    });
  });

  describe('mail', () => {
    it('defaults to the development log transport', () => {
      expect(loadConfig({}).MAIL_TRANSPORT).toBe('log');
    });

    it('needs a host and a sender to use SMTP, and user with password together', () => {
      expect(() => loadConfig({ MAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_HOST/);
      expect(() => loadConfig({ MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'mail.example.com' })).toThrow(
        /MAIL_FROM/,
      );
      expect(() =>
        loadConfig({
          MAIL_TRANSPORT: 'smtp',
          SMTP_HOST: 'mail.example.com',
          MAIL_FROM: 'IAM <no-reply@example.com>',
          SMTP_USER: 'no-reply@example.com',
        }),
      ).toThrow(/SMTP_USER/);
    });

    it('accepts a complete SMTP configuration with STARTTLS by default', () => {
      const config = loadConfig({
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'mail.example.com',
        MAIL_FROM: 'IAM <no-reply@example.com>',
        SMTP_USER: 'no-reply@example.com',
        SMTP_PASSWORD: 'secret-value',
      });
      expect(config).toMatchObject({ SMTP_PORT: 587, SMTP_SECURITY: 'starttls' });
    });

    it('does not start in production with the log transport, and never echoes the password', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/MAIL_TRANSPORT/);
      try {
        loadConfig({ MAIL_TRANSPORT: 'smtp', SMTP_PASSWORD: 'secret-value', SMTP_PORT: '0' });
      } catch (error) {
        expect(String(error)).not.toContain('secret-value');
      }
    });
  });
});
