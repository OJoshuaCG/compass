import { describe, expect, it } from 'vitest';

import {
  isSmtpSecurity,
  isValidSmtpPassword,
  isValidSmtpPort,
  normalizeSmtpFromAddress,
  normalizeSmtpHost,
  normalizeSmtpUsername,
} from './smtp-config.js';

describe('normalizeSmtpHost', () => {
  it('lowercases and trims a valid DNS name', () => {
    expect(normalizeSmtpHost('  SMTP.Example.com ')).toBe('smtp.example.com');
  });

  it.each([
    'localhost',
    '127.0.0.1',
    '10.0.0.5',
    'smtp.example.com:587',
    'https://smtp.example.com',
    'smtp example.com',
    'smtp.example.com/path',
    '-bad.example.com',
    'a..b.com',
    '',
  ])('rejects %s', (host) => {
    expect(normalizeSmtpHost(host)).toBeNull();
  });
});

describe('port, security, username, from and password', () => {
  it('accepts only ports 1..65535', () => {
    expect(isValidSmtpPort(587)).toBe(true);
    expect(isValidSmtpPort(0)).toBe(false);
    expect(isValidSmtpPort(65_536)).toBe(false);
    expect(isValidSmtpPort(25.5)).toBe(false);
  });

  it('never accepts an unencrypted mode', () => {
    expect(isSmtpSecurity('starttls')).toBe(true);
    expect(isSmtpSecurity('tls')).toBe(true);
    expect(isSmtpSecurity('none')).toBe(false);
  });

  it('rejects control characters in the username and the password', () => {
    expect(normalizeSmtpUsername('user@example.com')).toBe('user@example.com');
    expect(normalizeSmtpUsername('user\r\nRCPT TO:x')).toBeNull();
    expect(isValidSmtpPassword('s3cret pass')).toBe(true);
    expect(isValidSmtpPassword('bad\npass')).toBe(false);
    expect(isValidSmtpPassword('')).toBe(false);
  });

  it('accepts a plain address and rejects display names and lists', () => {
    expect(normalizeSmtpFromAddress('no-reply@example.com')).toBe('no-reply@example.com');
    expect(normalizeSmtpFromAddress('Compass <no-reply@example.com>')).toBeNull();
    expect(normalizeSmtpFromAddress('a@example.com, b@example.com')).toBeNull();
    expect(normalizeSmtpFromAddress('sin-arroba')).toBeNull();
  });
});
