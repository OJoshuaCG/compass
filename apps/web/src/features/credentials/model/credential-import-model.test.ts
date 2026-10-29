import type { CredentialImportPreview } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import {
  canConfirmImport,
  checkCsvFile,
  parseRowErrorLines,
  sliceRows,
} from './credential-import-model';

const previewWith = (counts: { valid: number; invalid: number; duplicate: number }) =>
  ({
    totalRows: counts.valid + counts.invalid + counts.duplicate,
    validRows: counts.valid,
    invalidRows: counts.invalid,
    duplicateRows: counts.duplicate,
    rows: [],
  }) satisfies CredentialImportPreview;

describe('checkCsvFile', () => {
  it('accepts a .csv up to 1,000,000 bytes, whatever the letter case', () => {
    expect(checkCsvFile({ name: 'cuentas.csv', size: 1 })).toBeNull();
    expect(checkCsvFile({ name: 'CUENTAS.CSV', size: 1_000_000 })).toBeNull();
  });

  it('rejects other extensions, empty files and files over the limit', () => {
    expect(checkCsvFile({ name: 'cuentas.txt', size: 10 })).toBe('not_csv');
    expect(checkCsvFile({ name: 'cuentas', size: 10 })).toBe('not_csv');
    expect(checkCsvFile({ name: 'cuentas.csv', size: 0 })).toBe('empty');
    expect(checkCsvFile({ name: 'cuentas.csv', size: 1_000_001 })).toBe('too_large');
  });
});

describe('canConfirmImport', () => {
  it('requires zero invalid rows and at least one valid row', () => {
    expect(canConfirmImport(previewWith({ valid: 2, invalid: 0, duplicate: 1 }))).toBe(true);
    expect(canConfirmImport(previewWith({ valid: 2, invalid: 1, duplicate: 0 }))).toBe(false);
    expect(canConfirmImport(previewWith({ valid: 0, invalid: 0, duplicate: 3 }))).toBe(false);
  });
});

describe('parseRowErrorLines', () => {
  it('keeps only line.N fields with a known row code', () => {
    expect(
      parseRowErrorLines([
        { field: 'line.3', code: 'PLATFORM_UNKNOWN' },
        { field: 'line.x', code: 'PLATFORM_UNKNOWN' },
        { field: 'line.4', code: 'NOT_A_CODE' },
        { field: 'csv', code: 'PASSWORD_REQUIRED' },
      ]),
    ).toEqual([{ line: 3, code: 'PLATFORM_UNKNOWN' }]);
  });
});

describe('sliceRows', () => {
  it('returns the requested window and tolerates the last partial page', () => {
    const rows = [1, 2, 3, 4, 5];
    expect(sliceRows(rows, 0, 2)).toEqual([1, 2]);
    expect(sliceRows(rows, 4, 2)).toEqual([5]);
  });
});
