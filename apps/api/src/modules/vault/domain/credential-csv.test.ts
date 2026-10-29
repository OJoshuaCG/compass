import { CREDENTIAL_IMPORT_MAX_BYTES, CREDENTIAL_IMPORT_MAX_ROWS } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { parseCsv, readImportFile, validateImportRow } from './credential-csv.js';
import type { ImportRow } from './credential-csv.js';

const HEADER = 'platform,account_name,credential_label,username,password';

const unwrapRows = (csv: string) => {
  const result = readImportFile(csv);
  if (!result.ok) throw new Error(`unexpected file error ${result.error.code}`);
  return result.value;
};

const fileErrorCode = (csv: string): string | null => {
  const result = readImportFile(csv);
  return result.ok ? null : result.error.code;
};

const validRow: ImportRow = {
  line: 2,
  shapeOk: true,
  platform: 'instagram',
  accountName: 'Brand page',
  credentialLabel: 'Main',
  username: 'brand@example.test',
  password: 'Sup3r-secret',
};

describe('parseCsv', () => {
  it('splits plain rows and reports the line where each row starts', () => {
    const parsed = parseCsv('a,b\n1,2\n3,4');
    expect(parsed.ok && parsed.value).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['1', '2'] },
      { line: 3, cells: ['3', '4'] },
    ]);
  });

  it('handles CRLF, lone CR and a trailing newline', () => {
    const crlf = parseCsv('a,b\r\n1,2\r\n');
    const cr = parseCsv('a,b\r1,2\r');
    expect(crlf.ok && crlf.value.map((row) => row.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(cr.ok && cr.value.map((row) => row.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a leading byte order mark', () => {
    const parsed = parseCsv('﻿a,b\n1,2');
    expect(parsed.ok && parsed.value[0]?.cells).toEqual(['a', 'b']);
  });

  it('keeps commas, doubled quotes and line breaks inside quoted fields', () => {
    const parsed = parseCsv('a,b\n"x, y","say ""hi""\nnow"\nlast,row');
    expect(parsed.ok && parsed.value).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['x, y', 'say "hi"\nnow'] },
      // El campo multilínea ocupa dos líneas: la fila siguiente empieza en la 4.
      { line: 4, cells: ['last', 'row'] },
    ]);
  });

  it('skips empty rows, including rows of only separators', () => {
    const parsed = parseCsv('a,b\n\n,\n1,2\n\n');
    expect(parsed.ok && parsed.value.map((row) => row.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps an empty quoted last field', () => {
    const parsed = parseCsv('a,b\n1,""');
    expect(parsed.ok && parsed.value[1]?.cells).toEqual(['1', '']);
  });

  it('rejects an unterminated quoted field without echoing the content', () => {
    const parsed = parseCsv('a,b\n1,"never closed');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe('CREDENTIAL_IMPORT.MALFORMED');
      expect(parsed.error.message).not.toContain('never closed');
    }
  });
});

describe('readImportFile', () => {
  it('maps cells by header name, ignoring case, spaces and column order', () => {
    const rows = unwrapRows(
      ' Password ,USERNAME,credential_label,account_name,platform\npw,user,Main,Brand,instagram',
    );
    expect(rows).toEqual([
      {
        line: 2,
        shapeOk: true,
        platform: 'instagram',
        accountName: 'Brand',
        credentialLabel: 'Main',
        username: 'user',
        password: 'pw',
      },
    ]);
  });

  it('trims names and username but keeps the password exactly as written', () => {
    const rows = unwrapRows(`${HEADER}\n instagram , Brand , Main , user ,  pw with spaces `);
    expect(rows[0]).toMatchObject({ accountName: 'Brand', username: 'user' });
    expect(rows[0]?.password).toBe('  pw with spaces ');
  });

  it('accepts the optional url and notes columns without exposing them', () => {
    const rows = unwrapRows(
      `${HEADER},url,notes\ninstagram,Brand,Main,user,pw,https://x.test,note`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shapeOk).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain('https://x.test');
  });

  it.each([
    ['a missing required column', 'platform,account_name,credential_label,username\na,b,c,d'],
    ['an unknown column', `${HEADER},extra\na,b,c,d,e,f`],
    ['a repeated column', `${HEADER},platform\na,b,c,d,e,f`],
  ])('rejects the whole file for %s', (_name, csv) => {
    expect(fileErrorCode(csv)).toBe('CREDENTIAL_IMPORT.HEADER_INVALID');
  });

  it('rejects a file with only a header or only blank lines', () => {
    expect(fileErrorCode(HEADER)).toBe('CREDENTIAL_IMPORT.EMPTY');
    expect(fileErrorCode('\n\n,\n')).toBe('CREDENTIAL_IMPORT.EMPTY');
  });

  it('enforces the 500-row cap on data rows only', () => {
    const row = 'instagram,Brand,Main,user,pw';
    const atLimit = [HEADER, ...Array.from({ length: CREDENTIAL_IMPORT_MAX_ROWS }, () => row)];
    const overLimit = [...atLimit, row];
    expect(fileErrorCode(atLimit.join('\n'))).toBeNull();
    expect(fileErrorCode(overLimit.join('\n'))).toBe('CREDENTIAL_IMPORT.TOO_MANY_ROWS');
  });

  it('measures the size limit in UTF-8 bytes, not characters', () => {
    const multibyte = 'ñ'.repeat(CREDENTIAL_IMPORT_MAX_BYTES / 2 + 1);
    expect(multibyte.length).toBeLessThan(CREDENTIAL_IMPORT_MAX_BYTES);
    expect(fileErrorCode(multibyte)).toBe('CREDENTIAL_IMPORT.FILE_TOO_LARGE');
  });

  it('flags a row with a different cell count than the header', () => {
    const rows = unwrapRows(`${HEADER}\ninstagram,Brand,Main,user`);
    expect(rows[0]?.shapeOk).toBe(false);
  });
});

describe('validateImportRow', () => {
  it('accepts a complete row', () => {
    expect(validateImportRow(validRow)).toEqual([]);
  });

  it('reports a malformed row as a single column mismatch', () => {
    expect(validateImportRow({ ...validRow, shapeOk: false })).toEqual(['COLUMN_COUNT_MISMATCH']);
  });

  it('reports every missing required value', () => {
    expect(
      validateImportRow({
        ...validRow,
        platform: '',
        accountName: '',
        credentialLabel: '',
        username: '',
        password: '',
      }),
    ).toEqual([
      'PLATFORM_REQUIRED',
      'ACCOUNT_NAME_REQUIRED',
      'CREDENTIAL_LABEL_REQUIRED',
      'USERNAME_REQUIRED',
      'PASSWORD_REQUIRED',
    ]);
  });

  it('applies the same length and control character rules as the manual forms', () => {
    expect(validateImportRow({ ...validRow, accountName: 'x'.repeat(201) })).toEqual([
      'ACCOUNT_NAME_INVALID',
    ]);
    expect(validateImportRow({ ...validRow, credentialLabel: 'a\u0000b' })).toEqual([
      'CREDENTIAL_LABEL_INVALID',
    ]);
    expect(validateImportRow({ ...validRow, username: 'x'.repeat(257) })).toEqual([
      'USERNAME_INVALID',
    ]);
    expect(validateImportRow({ ...validRow, password: 'x'.repeat(1025) })).toEqual([
      'PASSWORD_INVALID',
    ]);
  });

  it('lets a password carry any character, including control ones', () => {
    expect(validateImportRow({ ...validRow, password: 'tab\there' })).toEqual([]);
  });

  it('never puts the offending value in the error codes', () => {
    const codes = validateImportRow({ ...validRow, password: 'x'.repeat(1025) });
    expect(JSON.stringify(codes)).not.toContain('xxxx');
  });
});
