import { describe, expect, it } from 'vitest';

import {
  classifyDecodedText,
  decodeQrFromPixels,
  QR_DECODE_TARGET_SIDE_PX,
  QR_MAX_IMAGE_SIDE_PX,
  scaledDimensions,
} from './qr-decoder';
import { buildMigrationUri } from './migration-test-fixture';
import { renderQrPixels } from './qr-test-fixture';

const TOTP_URI =
  'otpauth://totp/Acme:ana%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Acme';
// Exportación truncada (un secreto de 10 bytes y una entrada cortada): no es válida.
const MALFORMED_MIGRATION_URI =
  'otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGAoJYWNtZTpkZW1v';
const MIGRATION_SECRET_TEXT = 'migration-secret-0123456789';
const MIGRATION_URI = buildMigrationUri([
  { secretText: MIGRATION_SECRET_TEXT, name: 'ana@example.com', issuer: 'Acme' },
  { secretText: MIGRATION_SECRET_TEXT, name: 'counter', issuer: 'Old', type: 1 },
]);

describe('decodeQrFromPixels with a real generated QR', () => {
  it('finds the otpauth TOTP link', () => {
    expect(decodeQrFromPixels(renderQrPixels(TOTP_URI))).toEqual({
      kind: 'found',
      otpauthUri: TOTP_URI,
    });
  });

  it('finds it when the QR is light on a dark background', () => {
    expect(decodeQrFromPixels(renderQrPixels(TOTP_URI, { inverted: true }))).toEqual({
      kind: 'found',
      otpauthUri: TOTP_URI,
    });
  });

  it('reads a Google Authenticator export into importable entries and a skipped count', () => {
    const result = decodeQrFromPixels(renderQrPixels(MIGRATION_URI));

    expect(result.kind).toBe('migration');
    if (result.kind !== 'migration') return;
    expect(result.entries.map((entry) => entry.label)).toEqual(['Acme: ana@example.com']);
    expect(result.skippedHotp).toBe(1);
    expect(result.skippedUnsupported).toBe(0);
    // El texto del enlace de migración no se arrastra al resultado.
    expect(JSON.stringify(result)).not.toContain('offline');
  });

  it('reports a malformed Google Authenticator export as invalid without echoing it', () => {
    const result = decodeQrFromPixels(renderQrPixels(MALFORMED_MIGRATION_URI));
    expect(result).toEqual({ kind: 'migration_invalid' });
    expect(JSON.stringify(result)).not.toContain('offline');
    expect(JSON.stringify(result)).not.toContain('CjEK');
  });

  it('reports a QR that is not an otpauth link without echoing it', () => {
    const result = decodeQrFromPixels(renderQrPixels('https://example.com/secret-page'));
    expect(result).toEqual({ kind: 'not_totp_uri' });
    expect(JSON.stringify(result)).not.toContain('example.com');
  });

  it('reports an HOTP link as not TOTP', () => {
    const result = decodeQrFromPixels(renderQrPixels('otpauth://hotp/Acme?secret=ABC&counter=1'));
    expect(result).toEqual({ kind: 'not_totp_uri' });
  });

  it('reports no QR on a blank image', () => {
    const side = 120;
    const blank = new Uint8ClampedArray(side * side * 4).fill(255);
    expect(decodeQrFromPixels({ data: blank, width: side, height: side })).toEqual({
      kind: 'no_qr',
    });
  });
});

describe('decodeQrFromPixels guards', () => {
  it('rejects an image above the size limit before touching the pixels', () => {
    const oversized = {
      data: new Uint8ClampedArray(4),
      width: QR_MAX_IMAGE_SIDE_PX + 1,
      height: 1,
    };
    expect(decodeQrFromPixels(oversized)).toEqual({ kind: 'image_too_large' });
  });

  it('rejects a buffer whose length does not match its dimensions', () => {
    expect(decodeQrFromPixels({ data: new Uint8ClampedArray(10), width: 4, height: 4 })).toEqual({
      kind: 'unreadable',
    });
  });
});

describe('classifyDecodedText', () => {
  it('trims and accepts the scheme in any letter case', () => {
    expect(classifyDecodedText(`  OTPAUTH://TOTP/Acme?secret=ABC  `)).toEqual({
      kind: 'found',
      otpauthUri: 'OTPAUTH://TOTP/Acme?secret=ABC',
    });
  });

  it('treats free text as not a TOTP link', () => {
    expect(classifyDecodedText('hello')).toEqual({ kind: 'not_totp_uri' });
  });
});

describe('classifyDecodedText with a migration link', () => {
  it('never puts decoded content in the invalid variant', () => {
    expect(classifyDecodedText('otpauth-migration://offline?data=%%%')).toEqual({
      kind: 'migration_invalid',
    });
  });
});

describe('scaledDimensions', () => {
  it('keeps small images as they are', () => {
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('scales a big image down keeping its proportions', () => {
    const scaled = scaledDimensions(4000, 2000);
    expect(scaled).toEqual({
      width: QR_DECODE_TARGET_SIDE_PX,
      height: QR_DECODE_TARGET_SIDE_PX / 2,
    });
  });
});
