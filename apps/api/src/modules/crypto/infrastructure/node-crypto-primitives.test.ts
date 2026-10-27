import { describe, expect, it } from 'vitest';

import { NodeCryptoPrimitives } from './node-crypto-primitives.js';

const primitives = new NodeCryptoPrimitives();
const hex = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'hex'));
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

// Vectores de "The Galois/Counter Mode of Operation" (McGrew & Viega), casos 15 y 16 (AES-256).
const KEY = hex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308');
const NONCE = hex('cafebabefacedbaddecaf888');
const PLAINTEXT = hex(
  'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72' +
    '1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255',
);
const CASE15_CIPHERTEXT =
  '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa' +
  '8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662898015ad';
const CASE15_TAG = 'b094dac5d93471bdec1a502270e3cc6c';

describe('AES-256-GCM known vectors', () => {
  it('matches NIST/McGrew-Viega test case 15 (no AAD)', () => {
    const sealed = primitives.aesGcmEncrypt({
      key: KEY,
      nonce: NONCE,
      aad: new Uint8Array(0),
      plaintext: PLAINTEXT,
    });
    expect(toHex(sealed)).toBe(CASE15_CIPHERTEXT + CASE15_TAG);
  });

  it('matches test case 16 (with AAD, 60-byte plaintext)', () => {
    const sealed = primitives.aesGcmEncrypt({
      key: KEY,
      nonce: NONCE,
      aad: hex('feedfacedeadbeeffeedfacedeadbeefabaddad2'),
      plaintext: PLAINTEXT.subarray(0, 60),
    });
    expect(toHex(sealed)).toBe(
      '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa' +
        '8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662' +
        '76fc6ece0f4e1768cddf8853bb2d551b',
    );
  });

  it('decrypts a known ciphertext back to the plaintext', () => {
    const opened = primitives.aesGcmDecrypt({
      key: KEY,
      nonce: NONCE,
      aad: new Uint8Array(0),
      ciphertext: hex(CASE15_CIPHERTEXT + CASE15_TAG),
    });
    expect(toHex(opened)).toBe(toHex(PLAINTEXT));
  });
});

describe('AES-256-GCM negative cases (all must fail)', () => {
  const aad = new TextEncoder().encode('org|cred|password|1');
  const plaintext = new TextEncoder().encode('s3cret');
  const nonce = primitives.randomBytes(12);
  const sealed = primitives.aesGcmEncrypt({ key: KEY, nonce, aad, plaintext });

  it('rejects an altered AAD', () => {
    expect(() =>
      primitives.aesGcmDecrypt({
        key: KEY,
        nonce,
        aad: new TextEncoder().encode('org|other|password|1'),
        ciphertext: sealed,
      }),
    ).toThrow();
  });

  it('rejects a wrong key', () => {
    const wrongKey = new Uint8Array(KEY).fill(7);
    expect(() =>
      primitives.aesGcmDecrypt({ key: wrongKey, nonce, aad, ciphertext: sealed }),
    ).toThrow();
  });

  it('rejects a wrong nonce', () => {
    expect(() =>
      primitives.aesGcmDecrypt({
        key: KEY,
        nonce: primitives.randomBytes(12),
        aad,
        ciphertext: sealed,
      }),
    ).toThrow();
  });

  it('rejects a flipped ciphertext bit', () => {
    const tampered = new Uint8Array(sealed);
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    expect(() =>
      primitives.aesGcmDecrypt({ key: KEY, nonce, aad, ciphertext: tampered }),
    ).toThrow();
  });

  it('rejects a flipped authentication-tag bit', () => {
    const tampered = new Uint8Array(sealed);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0x80;
    expect(() =>
      primitives.aesGcmDecrypt({ key: KEY, nonce, aad, ciphertext: tampered }),
    ).toThrow();
  });

  it('rejects a truncated ciphertext', () => {
    expect(() =>
      primitives.aesGcmDecrypt({
        key: KEY,
        nonce,
        aad,
        ciphertext: sealed.subarray(0, sealed.length - 1),
      }),
    ).toThrow();
    expect(() =>
      primitives.aesGcmDecrypt({ key: KEY, nonce, aad, ciphertext: new Uint8Array(3) }),
    ).toThrow();
  });

  it('rejects keys and nonces of the wrong length before using them', () => {
    expect(() =>
      primitives.aesGcmEncrypt({ key: new Uint8Array(16), nonce, aad, plaintext }),
    ).toThrow(RangeError);
    expect(() =>
      primitives.aesGcmEncrypt({ key: KEY, nonce: new Uint8Array(8), aad, plaintext }),
    ).toThrow(RangeError);
  });
});

describe('derivation and hashing known vectors', () => {
  it('HKDF-SHA256 matches RFC 5869 test case 1', () => {
    const okm = primitives.hkdfSha256({
      ikm: new Uint8Array(22).fill(0x0b),
      salt: hex('000102030405060708090a0b0c'),
      info: hex('f0f1f2f3f4f5f6f7f8f9'),
      length: 42,
    });
    expect(toHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('HMAC-SHA256 matches RFC 4231 test case 1', () => {
    const mac = primitives.hmacSha256(
      new Uint8Array(20).fill(0x0b),
      new TextEncoder().encode('Hi There'),
    );
    expect(toHex(mac)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('SHA-256 matches the FIPS 180-2 "abc" vector', () => {
    expect(toHex(primitives.sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('randomBytes', () => {
  it('returns the requested length and different values each call', () => {
    const a = primitives.randomBytes(12);
    const b = primitives.randomBytes(12);
    expect(a).toHaveLength(12);
    expect(toHex(a)).not.toBe(toHex(b));
  });
});
