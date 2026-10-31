import type { ShareLevel } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { canEditTotp, canExportTotp, canUseTotp } from './credential-access';
import {
  advanceIssuedCode,
  availableActionsFor,
  buildOtpauthUri,
  issuedCodeFrom,
  looksLikeOtpauthUri,
  normalizeBase32Key,
  secondsLeftOf,
  type TotpCapabilities,
} from './totp-model';

const LEVELS: (ShareLevel | null)[] = [null, 'USE', 'VIEW', 'EDIT', 'MANAGE'];
const gates = (check: (level: ShareLevel | null) => boolean) => LEVELS.map(check);

const KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const NOW_MS = 1_000_000;
const PERIOD_SECONDS = 30;

describe('second factor access gating', () => {
  it('code and status need USE or more AND the use_totp permission', () => {
    expect(gates((level) => canUseTotp(true, level))).toEqual([false, true, true, true, true]);
    expect(gates((level) => canUseTotp(false, level))).toEqual([false, false, false, false, false]);
  });

  it('register, confirm and retire need EDIT or more AND credential.update', () => {
    expect(gates((level) => canEditTotp(true, level))).toEqual([false, false, false, true, true]);
    expect(gates((level) => canEditTotp(false, level))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('export needs MANAGE AND credential.export_totp', () => {
    expect(gates((level) => canExportTotp(true, level))).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(gates((level) => canExportTotp(false, level))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('available actions by status', () => {
  const everything: TotpCapabilities = { canUse: true, canEdit: true, canExport: true };

  it('without a factor only registering is offered', () => {
    expect(availableActionsFor('none', everything)).toEqual({
      register: true,
      confirm: false,
      getCode: false,
      exportKey: false,
      retire: false,
      unlockConfirmation: false,
    });
  });

  it('pending allows confirming, codes, export and retire', () => {
    expect(availableActionsFor('pending', everything)).toEqual({
      register: true,
      confirm: true,
      getCode: true,
      exportKey: true,
      retire: true,
      unlockConfirmation: true,
    });
  });

  it('verified does not offer confirming again', () => {
    expect(availableActionsFor('verified', everything).confirm).toBe(false);
    expect(availableActionsFor('verified', everything).getCode).toBe(true);
  });

  it('offers the early unlock of the confirmation only for a pending factor', () => {
    expect(availableActionsFor('pending', everything).unlockConfirmation).toBe(true);
    expect(availableActionsFor('verified', everything).unlockConfirmation).toBe(false);
    expect(availableActionsFor('retired', everything).unlockConfirmation).toBe(false);
    expect(
      availableActionsFor('pending', { canUse: true, canEdit: true, canExport: false })
        .unlockConfirmation,
    ).toBe(false);
  });

  it('retired only allows registering again', () => {
    expect(availableActionsFor('retired', everything)).toEqual({
      register: true,
      confirm: false,
      getCode: false,
      exportKey: false,
      retire: false,
      unlockConfirmation: false,
    });
  });

  it('offers nothing without capabilities', () => {
    const nothing: TotpCapabilities = { canUse: false, canEdit: false, canExport: false };
    expect(Object.values(availableActionsFor('verified', nothing))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('building the otpauth link', () => {
  const base = { issuer: '', account: '', fallbackLabel: 'Portal de nómina' };

  it('recognizes an otpauth link regardless of case and surrounding spaces', () => {
    expect(looksLikeOtpauthUri('  OTPAUTH://totp/x?secret=abc')).toBe(true);
    expect(looksLikeOtpauthUri(KEY)).toBe(false);
  });

  it('normalizes the key: no spaces or hyphens and in uppercase', () => {
    expect(normalizeBase32Key('jbsw y3dp-ehpk')).toBe('JBSWY3DPEHPK');
  });

  it('keeps a pasted link untouched', () => {
    const link = `otpauth://totp/Acme:ana?secret=${KEY}&digits=8`;
    expect(buildOtpauthUri({ ...base, secretOrUri: `  ${link}  ` })).toBe(link);
  });

  it('builds a link from a key with issuer and account', () => {
    expect(
      buildOtpauthUri({
        ...base,
        secretOrUri: 'jbsw y3dp ehpk 3pxp jbsw y3dp ehpk 3pxp',
        issuer: 'Acme Inc',
        account: 'ana@example.com',
      }),
    ).toBe(`otpauth://totp/Acme%20Inc:ana%40example.com?secret=${KEY}&issuer=Acme%20Inc`);
  });

  it('uses the account, the issuer or the credential name as the label, in that order', () => {
    const withAccount = buildOtpauthUri({ ...base, secretOrUri: KEY, account: 'ana' });
    const withIssuer = buildOtpauthUri({ ...base, secretOrUri: KEY, issuer: 'Acme' });
    const withNothing = buildOtpauthUri({ ...base, secretOrUri: KEY });
    expect(withAccount).toBe(`otpauth://totp/ana?secret=${KEY}`);
    expect(withIssuer).toBe(`otpauth://totp/Acme?secret=${KEY}&issuer=Acme`);
    expect(withNothing).toBe(`otpauth://totp/Portal%20de%20n%C3%B3mina?secret=${KEY}`);
  });

  it('encodes values so a key cannot smuggle extra parameters', () => {
    const uri = buildOtpauthUri({ ...base, secretOrUri: `${KEY}&digits=8` });
    // La clave se pasa a mayúsculas, y el `&` sale codificado: no abre un parámetro nuevo.
    expect(uri).toContain(encodeURIComponent(`${KEY}&DIGITS=8`));
    expect(uri).not.toContain('&DIGITS=8');
  });

  it('returns null for blank input and for a link with control characters', () => {
    expect(buildOtpauthUri({ ...base, secretOrUri: '   ' })).toBeNull();
    expect(buildOtpauthUri({ ...base, secretOrUri: 'otpauth://totp/x?secret=A\nB' })).toBeNull();
  });
});

describe('issued code countdown', () => {
  it('counts the seconds left, rounding up', () => {
    const issued = issuedCodeFrom({ code: '123456', expiresIn: 20 }, NOW_MS);
    expect(secondsLeftOf(issued, NOW_MS)).toBe(20);
    expect(secondsLeftOf(issued, NOW_MS + 9_500)).toBe(11);
    expect(secondsLeftOf(issued, NOW_MS + 25_000)).toBe(0);
  });

  it('keeps the same reference while the code is valid', () => {
    const issued = issuedCodeFrom({ code: '123456', expiresIn: 20 }, NOW_MS);
    expect(advanceIssuedCode(issued, NOW_MS + 19_999, PERIOD_SECONDS)).toBe(issued);
  });

  it('discards the code at expiry when there is no next one', () => {
    const issued = issuedCodeFrom({ code: '123456', expiresIn: 20 }, NOW_MS);
    expect(advanceIssuedCode(issued, NOW_MS + 20_000, PERIOD_SECONDS)).toBeNull();
  });

  it('promotes the next code for a full period, then discards it', () => {
    const issued = issuedCodeFrom({ code: '123456', expiresIn: 3, nextCode: '654321' }, NOW_MS);
    const promoted = advanceIssuedCode(issued, NOW_MS + 4_000, PERIOD_SECONDS);
    expect(promoted?.code).toBe('654321');
    expect(promoted?.nextCode).toBeUndefined();
    expect(promoted === null ? 0 : secondsLeftOf(promoted, NOW_MS + 4_000)).toBe(29);
    expect(advanceIssuedCode(issued, NOW_MS + 33_000, PERIOD_SECONDS)).toBeNull();
  });
});
