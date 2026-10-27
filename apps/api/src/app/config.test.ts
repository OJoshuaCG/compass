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
});
