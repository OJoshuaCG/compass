import { describe, expect, it } from 'vitest';

import {
  MIGRATION_MAX_ENTRIES,
  MIGRATION_MAX_SECRET_BYTES,
  MIGRATION_MAX_TEXT_CHARACTERS,
  parseGoogleAuthenticatorMigration,
} from './google-authenticator-migration';

// --- Codificador protobuf mínimo, solo para generar fixtures sintéticos (ningún QR real). ---

const ALGORITHM_SHA1 = 1;
const ALGORITHM_SHA256 = 2;
const ALGORITHM_SHA512 = 3;
const ALGORITHM_MD5 = 4;
const DIGITS_SIX = 1;
const DIGITS_EIGHT = 2;
const TYPE_HOTP = 1;
const TYPE_TOTP = 2;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

function varint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return bytes;
}

function tag(fieldNumber: number, wireType: number): number[] {
  return varint(fieldNumber * 8 + wireType);
}

function lengthDelimited(fieldNumber: number, payload: readonly number[]): number[] {
  return [...tag(fieldNumber, WIRE_LENGTH_DELIMITED), ...varint(payload.length), ...payload];
}

function varintField(fieldNumber: number, value: number): number[] {
  return [...tag(fieldNumber, WIRE_VARINT), ...varint(value)];
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

type EntryOptions = {
  secret?: readonly number[];
  name?: string;
  issuer?: string;
  algorithm?: number;
  digits?: number;
  type?: number;
  extra?: readonly number[];
};

// 20 bytes ASCII "12345678901234567890" (secreto de prueba del RFC 6238). Su Base32 es conocido.
const RFC_SECRET: readonly number[] = utf8('12345678901234567890');
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function otpParameters(options: EntryOptions = {}): number[] {
  return [
    ...lengthDelimited(1, options.secret ?? RFC_SECRET),
    ...lengthDelimited(2, utf8(options.name ?? 'ana@example.com')),
    ...lengthDelimited(3, utf8(options.issuer ?? 'Acme')),
    ...varintField(4, options.algorithm ?? ALGORITHM_SHA1),
    ...varintField(5, options.digits ?? DIGITS_SIX),
    ...varintField(6, options.type ?? TYPE_TOTP),
    ...(options.extra ?? []),
  ];
}

function payloadOf(
  entries: readonly (readonly number[])[],
  extra: readonly number[] = [],
): number[] {
  return [
    ...entries.flatMap((entry) => lengthDelimited(1, entry)),
    ...varintField(2, 1),
    ...varintField(3, 1),
    ...varintField(4, 0),
    ...varintField(5, 123456789),
    ...extra,
  ];
}

function toBase64(bytes: readonly number[], options: { urlSafe?: boolean; padded?: boolean } = {}) {
  let text = btoa(String.fromCharCode(...bytes));
  if (options.urlSafe === true) text = text.replaceAll('+', '-').replaceAll('/', '_');
  if (options.padded === false) text = text.replaceAll('=', '');
  return text;
}

function migrationUri(
  bytes: readonly number[],
  options: { urlSafe?: boolean; padded?: boolean } = {},
) {
  return `otpauth-migration://offline?data=${encodeURIComponent(toBase64(bytes, options))}`;
}

// El alineamiento del secreto dentro del mensaje decide qué caracteres base64 salen: se prueban los
// tres posibles desfases hasta que un bloque 0xfb 0xef 0xbe ("++++") y otro 0xff x3 ("////") queden
// alineados, para que las pruebas del alfabeto seguro para URL no dependan de la suerte.
function secretThatEncodesWithPlusAndSlash(): number[] {
  for (const padding of [0, 1, 2]) {
    const secret = [
      ...Array<number>(padding).fill(0),
      0xfb,
      0xef,
      0xbe,
      0xff,
      0xff,
      0xff,
      ...RFC_SECRET,
    ];
    const text = toBase64(payloadOf([otpParameters({ secret })]));
    if (text.includes('+') && text.includes('/')) return secret;
  }
  throw new Error('fixture without + and / in base64');
}

function parseBytes(bytes: readonly number[]) {
  return parseGoogleAuthenticatorMigration(migrationUri(bytes));
}

function expectInvalidWithoutContent(result: ReturnType<typeof parseGoogleAuthenticatorMigration>) {
  expect(result).toEqual({ kind: 'invalid' });
  // Ni el secreto ni los nombres de los fixtures pueden aparecer en un resultado inválido.
  expect(JSON.stringify(result)).not.toContain(RFC_SECRET_BASE32);
  expect(JSON.stringify(result)).not.toContain('Acme');
}

describe('parseGoogleAuthenticatorMigration: valid exports', () => {
  it('reads one TOTP entry into a standard otpauth link', () => {
    const result = parseBytes(payloadOf([otpParameters()]));

    expect(result).toEqual({
      kind: 'ok',
      entries: [
        {
          label: 'Acme: ana@example.com',
          otpauthUri: `otpauth://totp/Acme:ana%40example.com?secret=${RFC_SECRET_BASE32}&issuer=Acme`,
        },
      ],
      skippedHotp: 0,
      skippedUnsupported: 0,
    });
  });

  it('keeps the order of several entries', () => {
    const result = parseBytes(
      payloadOf([
        otpParameters({ name: 'one', issuer: 'First' }),
        otpParameters({ name: 'two', issuer: 'Second' }),
        otpParameters({ name: 'three', issuer: 'Third' }),
      ]),
    );

    expect(result.kind === 'ok' ? result.entries.map((entry) => entry.label) : []).toEqual([
      'First: one',
      'Second: two',
      'Third: three',
    ]);
  });

  it('counts HOTP entries apart and does not import them', () => {
    const result = parseBytes(
      payloadOf([otpParameters({ type: TYPE_HOTP }), otpParameters({ name: 'kept' })]),
    );

    expect(result).toMatchObject({ kind: 'ok', skippedHotp: 1, skippedUnsupported: 0 });
    expect(result.kind === 'ok' ? result.entries : []).toHaveLength(1);
  });

  it('adds algorithm and digits only when they are not SHA1 and 6 digits', () => {
    const result = parseBytes(
      payloadOf([
        otpParameters({ name: 'a', algorithm: ALGORITHM_SHA256, digits: DIGITS_EIGHT }),
        otpParameters({ name: 'b', algorithm: ALGORITHM_SHA512 }),
        otpParameters({ name: 'c', digits: DIGITS_EIGHT }),
      ]),
    );

    const uris = result.kind === 'ok' ? result.entries.map((entry) => entry.otpauthUri) : [];
    expect(uris[0]).toContain('&issuer=Acme&algorithm=SHA256&digits=8');
    expect(uris[1]).toContain('&issuer=Acme&algorithm=SHA512');
    expect(uris[1]).not.toContain('digits=');
    expect(uris[2]).toContain('&issuer=Acme&digits=8');
    expect(uris[2]).not.toContain('algorithm=');
  });

  it('treats unspecified algorithm and digits as SHA1 and 6 digits', () => {
    const entry = [
      ...lengthDelimited(1, RFC_SECRET),
      ...lengthDelimited(2, utf8('ana')),
      ...varintField(6, TYPE_TOTP),
    ];
    const result = parseBytes(payloadOf([entry]));

    expect(result.kind === 'ok' ? result.entries[0]?.otpauthUri : '').toBe(
      `otpauth://totp/ana?secret=${RFC_SECRET_BASE32}`,
    );
  });

  it('does not repeat the issuer when the name already starts with it', () => {
    const result = parseBytes(payloadOf([otpParameters({ name: 'Acme:ana', issuer: 'Acme' })]));

    expect(result.kind === 'ok' ? result.entries[0] : undefined).toEqual({
      label: 'Acme: ana',
      otpauthUri: `otpauth://totp/Acme:ana?secret=${RFC_SECRET_BASE32}&issuer=Acme`,
    });
  });

  it('percent-encodes reserved characters in the label and the issuer', () => {
    const result = parseBytes(
      payloadOf([otpParameters({ name: 'a b/c?d#e&f', issuer: 'Ñandú & Co' })]),
    );

    const uri = result.kind === 'ok' ? (result.entries[0]?.otpauthUri ?? '') : '';
    expect(uri).toBe(
      `otpauth://totp/%C3%91and%C3%BA%20%26%20Co:a%20b%2Fc%3Fd%23e%26f?secret=${RFC_SECRET_BASE32}&issuer=%C3%91and%C3%BA%20%26%20Co`,
    );
    // Un `&` en el nombre no puede colar parámetros: el URI solo tiene el `secret` y el `issuer`.
    expect(new URL(uri).searchParams.get('secret')).toBe(RFC_SECRET_BASE32);
    expect([...new URL(uri).searchParams.keys()]).toEqual(['secret', 'issuer']);
  });

  it('accepts an entry without name and issuer', () => {
    const entry = [...lengthDelimited(1, RFC_SECRET), ...varintField(6, TYPE_TOTP)];
    const result = parseBytes(payloadOf([entry]));

    expect(result.kind === 'ok' ? result.entries[0]?.label : undefined).toBe('');
  });

  it('skips unknown fields of every supported wire type, in the payload and in the entries', () => {
    const unknownInEntry = [
      ...varintField(7, 1), // counter
      ...varintField(15, 99),
      ...tag(9, WIRE_FIXED64),
      ...[1, 2, 3, 4, 5, 6, 7, 8],
      ...tag(10, WIRE_FIXED32),
      ...[1, 2, 3, 4],
      ...lengthDelimited(11, [9, 9, 9]),
    ];
    const unknownInPayload = [
      ...tag(20, WIRE_FIXED32),
      ...[0, 0, 0, 0],
      ...lengthDelimited(21, utf8('future')),
    ];
    const result = parseBytes(
      payloadOf([otpParameters({ extra: unknownInEntry })], unknownInPayload),
    );

    expect(result).toMatchObject({ kind: 'ok', skippedHotp: 0, skippedUnsupported: 0 });
    expect(result.kind === 'ok' ? result.entries : []).toHaveLength(1);
  });

  it('accepts URL-safe base64 without padding', () => {
    const bytes = payloadOf([otpParameters({ secret: secretThatEncodesWithPlusAndSlash() })]);
    const standard = toBase64(bytes);
    const urlSafeUnpadded = toBase64(bytes, { urlSafe: true, padded: false });
    expect(urlSafeUnpadded).toContain('-');
    expect(urlSafeUnpadded).toContain('_');
    expect(urlSafeUnpadded).not.toContain('=');

    const fromStandard = parseGoogleAuthenticatorMigration(
      `otpauth-migration://offline?data=${encodeURIComponent(standard)}`,
    );
    const fromUrlSafe = parseGoogleAuthenticatorMigration(
      `otpauth-migration://offline?data=${urlSafeUnpadded}`,
    );

    expect(fromUrlSafe.kind).toBe('ok');
    expect(fromUrlSafe).toEqual(fromStandard);
  });

  it('accepts a raw "+" in the data parameter (not turned into a space)', () => {
    const bytes = payloadOf([otpParameters({ secret: secretThatEncodesWithPlusAndSlash() })]);
    const standard = toBase64(bytes);
    expect(standard).toContain('+');

    const raw = parseGoogleAuthenticatorMigration(`otpauth-migration://offline?data=${standard}`);
    const escaped = parseGoogleAuthenticatorMigration(migrationUri(bytes));

    expect(raw.kind).toBe('ok');
    expect(raw).toEqual(escaped);
  });

  it('accepts the scheme in any letter case and surrounding spaces', () => {
    const uri = migrationUri(payloadOf([otpParameters()]));
    const mixedCase = `  OTPAUTH-MIGRATION://${uri.slice('otpauth-migration://'.length)}  `;

    expect(parseGoogleAuthenticatorMigration(mixedCase).kind).toBe('ok');
  });
});

describe('parseGoogleAuthenticatorMigration: entries that cannot be imported', () => {
  it('marks MD5 as unsupported instead of building a link the server would reject', () => {
    const result = parseBytes(payloadOf([otpParameters({ algorithm: ALGORITHM_MD5 })]));

    expect(result).toEqual({ kind: 'ok', entries: [], skippedHotp: 0, skippedUnsupported: 1 });
  });

  it('marks unknown algorithm, digits and type values as unsupported', () => {
    const result = parseBytes(
      payloadOf([
        otpParameters({ algorithm: 9 }),
        otpParameters({ digits: 7 }),
        otpParameters({ type: 0 }),
        otpParameters({ type: 3 }),
      ]),
    );

    expect(result).toMatchObject({ kind: 'ok', skippedHotp: 0, skippedUnsupported: 4 });
    expect(result.kind === 'ok' ? result.entries : []).toHaveLength(0);
  });

  it('marks a secret under 128 bits as unsupported, because the server requires 128 bits', () => {
    const tenBytes = utf8('1234567890');
    const result = parseBytes(payloadOf([otpParameters({ secret: tenBytes })]));

    expect(result).toEqual({ kind: 'ok', entries: [], skippedHotp: 0, skippedUnsupported: 1 });
  });

  it('marks as unsupported an entry whose escaped link exceeds the server limit', () => {
    // Un carácter fuera del plano básico ocupa 12 caracteres escapados: 200 de ellos rebasan 2048.
    const heavy = '😀'.repeat(MIGRATION_MAX_TEXT_CHARACTERS);
    const result = parseBytes(payloadOf([otpParameters({ name: heavy, issuer: heavy })]));

    expect(result).toMatchObject({ kind: 'ok', skippedUnsupported: 1 });
    expect(result.kind === 'ok' ? result.entries : []).toHaveLength(0);
  });

  it('still returns ok with nothing importable when every entry is skipped', () => {
    const result = parseBytes(payloadOf([otpParameters({ type: TYPE_HOTP })]));

    expect(result).toEqual({ kind: 'ok', entries: [], skippedHotp: 1, skippedUnsupported: 0 });
  });
});

describe('parseGoogleAuthenticatorMigration: malformed or hostile input', () => {
  it('rejects a varint truncated in the middle', () => {
    // Etiqueta de entrada y una longitud cuyo byte dice "continúa" pero ahí termina el búfer.
    expectInvalidWithoutContent(parseBytes([0x0a, 0x80]));
  });

  it('rejects a varint longer than ten bytes', () => {
    expectInvalidWithoutContent(parseBytes([0x10, ...Array<number>(11).fill(0xff), 0x01]));
  });

  it('rejects a length that exceeds the buffer', () => {
    expectInvalidWithoutContent(parseBytes([0x0a, 0x7f, 0x01, 0x02, 0x03]));
  });

  it('rejects a nested length that exceeds its entry', () => {
    // La entrada mide 4 bytes, pero el secreto declara 50.
    expectInvalidWithoutContent(parseBytes(lengthDelimited(1, [0x0a, 50, 1, 2])));
  });

  it('rejects wire types 3, 4, 6 and 7', () => {
    for (const wireType of [3, 4, 6, 7]) {
      expectInvalidWithoutContent(parseBytes([...tag(30, wireType), 0x00]));
    }
  });

  it('rejects field number zero', () => {
    expectInvalidWithoutContent(parseBytes([0x00, 0x00]));
  });

  it('rejects a known entry field sent with the wrong wire type', () => {
    const entry = [...varintField(1, 5), ...varintField(6, TYPE_TOTP)];
    expectInvalidWithoutContent(parseBytes(payloadOf([entry])));
  });

  it('rejects an otp_parameters field that is not length-delimited', () => {
    expectInvalidWithoutContent(parseBytes(varintField(1, 5)));
  });

  it('rejects fixed-width fields cut short', () => {
    expectInvalidWithoutContent(parseBytes([...tag(9, WIRE_FIXED64), 1, 2, 3]));
    expectInvalidWithoutContent(parseBytes([...tag(10, WIRE_FIXED32), 1, 2]));
  });

  it('rejects invalid base64', () => {
    for (const data of ['!!!!', 'abc$', 'A', 'AAAAA', '====']) {
      expectInvalidWithoutContent(
        parseGoogleAuthenticatorMigration(`otpauth-migration://offline?data=${data}`),
      );
    }
  });

  it('rejects a malformed percent escape and a missing data parameter', () => {
    expectInvalidWithoutContent(
      parseGoogleAuthenticatorMigration('otpauth-migration://offline?data=%E0%A4%A'),
    );
    expectInvalidWithoutContent(
      parseGoogleAuthenticatorMigration('otpauth-migration://offline?other=abc'),
    );
    expectInvalidWithoutContent(parseGoogleAuthenticatorMigration('otpauth-migration://offline'));
    expectInvalidWithoutContent(
      parseGoogleAuthenticatorMigration('otpauth-migration://offline?data='),
    );
  });

  it('rejects text that is not a migration link', () => {
    expectInvalidWithoutContent(
      parseGoogleAuthenticatorMigration('https://example.com/?data=AAAA'),
    );
  });

  it('rejects an empty export (no accounts at all)', () => {
    expectInvalidWithoutContent(parseBytes(payloadOf([])));
  });

  it('rejects more entries than the limit', () => {
    const entries = Array.from({ length: MIGRATION_MAX_ENTRIES + 1 }, (_, index) =>
      otpParameters({ name: `n${String(index)}`, issuer: 'I' }),
    );
    expectInvalidWithoutContent(parseBytes(payloadOf(entries)));

    const atLimit = Array.from({ length: MIGRATION_MAX_ENTRIES }, (_, index) =>
      otpParameters({ name: `n${String(index)}`, issuer: 'I' }),
    );
    const accepted = parseBytes(payloadOf(atLimit));
    expect(accepted.kind === 'ok' ? accepted.entries : []).toHaveLength(MIGRATION_MAX_ENTRIES);
  });

  it('rejects an empty secret, a missing secret and an oversized secret', () => {
    expectInvalidWithoutContent(parseBytes(payloadOf([otpParameters({ secret: [] })])));
    expectInvalidWithoutContent(
      parseBytes(payloadOf([[...lengthDelimited(2, utf8('x')), ...varintField(6, TYPE_TOTP)]])),
    );
    expectInvalidWithoutContent(
      parseBytes(
        payloadOf([
          otpParameters({ secret: Array<number>(MIGRATION_MAX_SECRET_BYTES + 1).fill(7) }),
        ]),
      ),
    );
    const largest = parseBytes(
      payloadOf([otpParameters({ secret: Array<number>(MIGRATION_MAX_SECRET_BYTES).fill(7) })]),
    );
    expect(largest.kind).toBe('ok');
  });

  it('rejects invalid UTF-8 in the name or the issuer', () => {
    const invalidName = [
      ...lengthDelimited(1, RFC_SECRET),
      ...lengthDelimited(2, [0xff, 0xfe, 0x41]),
      ...varintField(6, TYPE_TOTP),
    ];
    const invalidIssuer = [
      ...lengthDelimited(1, RFC_SECRET),
      ...lengthDelimited(3, [0xc3, 0x28]),
      ...varintField(6, TYPE_TOTP),
    ];
    expectInvalidWithoutContent(parseBytes(payloadOf([invalidName])));
    expectInvalidWithoutContent(parseBytes(payloadOf([invalidIssuer])));
  });

  it('rejects a name or an issuer longer than the limit', () => {
    const tooLong = 'a'.repeat(MIGRATION_MAX_TEXT_CHARACTERS + 1);
    expectInvalidWithoutContent(parseBytes(payloadOf([otpParameters({ name: tooLong })])));
    expectInvalidWithoutContent(parseBytes(payloadOf([otpParameters({ issuer: tooLong })])));

    const exact = 'a'.repeat(MIGRATION_MAX_TEXT_CHARACTERS);
    expect(parseBytes(payloadOf([otpParameters({ name: exact })])).kind).toBe('ok');
  });

  it('rejects a payload above the size limit before decoding it', () => {
    const huge = 'A'.repeat(20_000);
    expectInvalidWithoutContent(
      parseGoogleAuthenticatorMigration(`otpauth-migration://offline?data=${huge}`),
    );
    expectInvalidWithoutContent(
      parseGoogleAuthenticatorMigration(`otpauth-migration://offline?data=${'A'.repeat(40_000)}`),
    );
  });

  it('never throws on random garbage', () => {
    // Semilla fija: la prueba es determinista.
    let state = 12345;
    const nextByte = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % 256;
    };
    for (let round = 0; round < 200; round += 1) {
      const length = (round % 40) + 1;
      const bytes = Array.from({ length }, nextByte);
      expect(() => parseBytes(bytes)).not.toThrow();
    }
  });
});
