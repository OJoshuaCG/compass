import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';

import {
  expectOutcomeConfirmingIdentity,
  freshCode,
  signInAsRoot,
  storageDump,
  watchSecurityViolations,
} from './support/identity-helpers.js';
import { base32OfText, migrationUri, qrPng } from './support/qr-image.js';

// Todo lo de este archivo es ficticio y obviamente falso; nada se escribe en disco.

// Plataformas del catálogo global sembrado por la migración 0005 (coinciden por nombre).
const ACCOUNT_A = 'E2E Csv Account A';
const ACCOUNT_B = 'E2E Csv Account B';
const LABEL_A = 'Csv login A';
const LABEL_B = 'Csv login B';
const PASSWORD_A = 'Csv-Fake-Passphrase-A-1001';
const PASSWORD_B = 'Csv-Fake-Passphrase-B-2002';
const VALID_CSV = [
  'platform,account_name,credential_label,username,password',
  `Instagram,${ACCOUNT_A},${LABEL_A},csv.a@e2e.test,${PASSWORD_A}`,
  `Facebook,${ACCOUNT_B},${LABEL_B},csv.b@e2e.test,${PASSWORD_B}`,
  '',
].join('\n');

const BROKEN_PASSWORD = 'Csv-Fake-Passphrase-Broken-3003';
// Una fila con plataforma inexistente y otra sin contraseña: ninguna se puede importar.
const INVALID_ROWS_CSV = [
  'platform,account_name,credential_label,username,password',
  `Plataforma Inventada,E2E Csv Broken One,Broken one,broken.one@e2e.test,${BROKEN_PASSWORD}`,
  'Instagram,E2E Csv Broken Two,Broken two,broken.two@e2e.test,',
  '',
].join('\n');
const WRONG_HEADER_CSV = ['nombre,clave', 'algo,algo-falso', ''].join('\n');

// Claves falsas de 20 caracteres (el mínimo importable son 16 bytes).
const SECRET_TEXT_A = 'e2e-not-a-real-key-A';
const SECRET_TEXT_B = 'e2e-not-a-real-key-B';
const ISSUER = 'E2E Fake Issuer';
const NAME_A = 'a@e2e.test';
const NAME_B = 'b@e2e.test';

/** Valor del conteo (`dd`) que acompaña a una etiqueta (`dt`) dentro de un bloque de resumen. */
function summaryCount(summary: Locator, label: string): Locator {
  return summary
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) })
    .locator('xpath=following-sibling::*[1]');
}

async function openAccounts(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Vault', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
}

async function openCsvImport(page: Page): Promise<void> {
  await openAccounts(page);
  await page.getByRole('link', { name: 'Import from CSV' }).click();
  await expect(page.getByRole('heading', { name: 'Import credentials from a CSV' })).toBeVisible();
}

async function chooseCsv(page: Page, name: string, content: string): Promise<void> {
  // El archivo vive solo en memoria. El campo declara `accept`, pero `setInputFiles` lo ignora,
  // igual que lo haría un archivo arrastrado: así se prueba la comprobación propia de la extensión.
  await page.getByLabel('CSV file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(content, 'utf-8'),
  });
}

/** ¿Aparece el texto en el HTML, en el valor de algún campo, en el almacenamiento o en la URL? */
async function leaksAnywhere(page: Page, needle: string): Promise<boolean> {
  const inDocument = await page.evaluate(
    (text) =>
      document.documentElement.outerHTML.includes(text) ||
      Array.from(document.querySelectorAll('input, textarea')).some((field) =>
        (field as HTMLInputElement | HTMLTextAreaElement).value.includes(text),
      ),
    needle,
  );
  const inStorage = (await storageDump(page)).includes(needle);
  return inDocument || inStorage || page.url().includes(needle);
}

test.describe.serial('credential imports in a real browser (CSV and Google Authenticator)', () => {
  // Una sola sesión: cada código TOTP nuevo puede costar hasta ~30 s de espera.
  let context: BrowserContext;
  let page: Page;
  let violations: string[];
  let rootSecret = '';

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    context = await browser.newContext({ locale: 'en-US' });
    page = await context.newPage();
    violations = watchSecurityViolations(page);
    rootSecret = await signInAsRoot(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('a CSV with a wrong header is rejected with a message and no preview', async () => {
    test.setTimeout(120_000);
    await openCsvImport(page);
    await chooseCsv(page, 'wrong-header.csv', WRONG_HEADER_CSV);

    await expectOutcomeConfirmingIdentity(
      page,
      rootSecret,
      page.getByText(/The header is not valid\./),
    );
    await expect(page.getByRole('table', { name: 'Preview of the rows in the file' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  });

  test('a file without the .csv extension is rejected in the browser', async () => {
    await openCsvImport(page);
    await chooseCsv(page, 'accounts.txt', VALID_CSV);

    await expect(page.getByText('Choose a file with the .csv extension.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Preview of the rows in the file' })).toHaveCount(
      0,
    );
    expect(await leaksAnywhere(page, PASSWORD_A)).toBe(false);
  });

  test('a CSV with invalid rows lists them first and blocks the import', async () => {
    test.setTimeout(120_000);
    await openCsvImport(page);
    await chooseCsv(page, 'invalid-rows.csv', INVALID_ROWS_CSV);

    const summary = page.getByRole('region', { name: 'File summary' });
    await expectOutcomeConfirmingIdentity(page, rootSecret, summary);
    await expect(summaryCount(summary, 'Rows')).toHaveText('2');
    await expect(summaryCount(summary, 'Valid')).toHaveText('0');
    await expect(summaryCount(summary, 'Invalid')).toHaveText('2');
    await expect(
      page.getByText('Some rows are not valid, so nothing can be imported.'),
    ).toBeVisible();

    const previewTable = page.getByRole('table', { name: 'Preview of the rows in the file' });
    await expect(
      previewTable.getByText('The platform does not match any existing platform.'),
    ).toBeVisible();
    await expect(previewTable.getByText('The password is required.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

    // La vista previa nunca devuelve contraseñas ni usuarios: tampoco quedan en pantalla.
    expect(await leaksAnywhere(page, BROKEN_PASSWORD)).toBe(false);
  });

  test('a valid CSV previews, imports on confirmation and leaves no secret behind', async () => {
    test.setTimeout(150_000);
    await openCsvImport(page);
    await chooseCsv(page, 'valid-accounts.csv', VALID_CSV);

    const summary = page.getByRole('region', { name: 'File summary' });
    await expectOutcomeConfirmingIdentity(page, rootSecret, summary);
    await expect(summaryCount(summary, 'Rows')).toHaveText('2');
    await expect(summaryCount(summary, 'Valid')).toHaveText('2');
    await expect(summaryCount(summary, 'Invalid')).toHaveText('0');
    await expect(
      page.getByText('The file is valid. Review the rows and confirm to import them.'),
    ).toBeVisible();
    // Antes de confirmar todavía no se creó nada y la contraseña no se muestra.
    expect(await leaksAnywhere(page, PASSWORD_A)).toBe(false);

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const result = page.getByRole('region', { name: 'Import result' });
    await expectOutcomeConfirmingIdentity(page, rootSecret, result);
    await expect(page.getByText('Import complete.')).toBeVisible();
    await expect(summaryCount(result, 'Accounts created')).toHaveText('2');
    await expect(summaryCount(result, 'Credentials created')).toHaveText('2');

    // Terminada la importación, ni las contraseñas ni los usuarios quedan en el DOM, el almacenamiento o la URL.
    for (const secret of [PASSWORD_A, PASSWORD_B, 'csv.a@e2e.test']) {
      expect(await leaksAnywhere(page, secret)).toBe(false);
    }

    await openAccounts(page);
    const accountsTable = page.getByRole('table', { name: 'Accounts you have access to' });
    await expect(accountsTable.getByText(ACCOUNT_A)).toBeVisible();
    await expect(accountsTable.getByText(ACCOUNT_B)).toBeVisible();
  });

  test('an invalid Google Authenticator export or image shows a message and registers nothing', async () => {
    test.setTimeout(120_000);
    const dialog = await openSecondFactorDialog(page, ACCOUNT_A, LABEL_A);
    await dialog.getByRole('tab', { name: 'QR code image' }).click();
    const fileInput = dialog.getByLabel('QR code image file');
    const registerButton = dialog.getByRole('button', { name: 'Register', exact: true });

    // Una exportación dañada (truncada): el mensaje no repite nada de lo decodificado.
    await fileInput.setInputFiles({
      name: 'broken-export.png',
      mimeType: 'image/png',
      buffer: qrPng('otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGAoJYWNtZTpkZW1v'),
    });
    await expect(
      dialog.getByText(/is a Google Authenticator export, but it is damaged/),
    ).toBeVisible();
    await expect(registerButton).toBeDisabled();

    // Un QR válido que no es un enlace TOTP.
    await fileInput.setInputFiles({
      name: 'plain-text.png',
      mimeType: 'image/png',
      buffer: qrPng('just some harmless words'),
    });
    await expect(dialog.getByText(/does not contain an otpauth:\/\/ link/)).toBeVisible();
    await expect(registerButton).toBeDisabled();

    // Una exportación que solo trae cuentas por contador (HOTP): no hay nada importable.
    await fileInput.setInputFiles({
      name: 'only-hotp.png',
      mimeType: 'image/png',
      buffer: qrPng(
        migrationUri([{ secretText: SECRET_TEXT_A, name: NAME_A, issuer: ISSUER, kind: 'hotp' }]),
      ),
    });
    await expect(
      dialog.getByText('The Google Authenticator export has no account that can be imported.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText('1 counter-based (HOTP) account was skipped; it cannot be imported.'),
    ).toBeVisible();
    await expect(registerButton).toBeDisabled();

    // Un archivo que ni siquiera es una imagen admitida.
    await fileInput.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image', 'utf-8'),
    });
    await expect(dialog.getByText('Only PNG, JPEG or WebP images are accepted.')).toBeVisible();
    await expect(registerButton).toBeDisabled();

    for (const secret of [SECRET_TEXT_A, base32OfText(SECRET_TEXT_A), 'otpauth://totp']) {
      expect(await leaksAnywhere(page, secret)).toBe(false);
    }
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
  });

  test('a Google Authenticator export with several accounts registers the chosen one and leaves no secret behind', async () => {
    test.setTimeout(150_000);
    const dialog = await openSecondFactorDialog(page, ACCOUNT_A, LABEL_A);
    await expect(dialog.getByText('No second factor')).toBeVisible();
    await dialog.getByRole('tab', { name: 'QR code image' }).click();

    await dialog.getByLabel('QR code image file').setInputFiles({
      name: 'authenticator-export.png',
      mimeType: 'image/png',
      buffer: qrPng(
        migrationUri([
          { secretText: SECRET_TEXT_A, name: NAME_A, issuer: ISSUER },
          { secretText: SECRET_TEXT_B, name: NAME_B, issuer: ISSUER },
          { secretText: SECRET_TEXT_A, name: 'counter@e2e.test', issuer: ISSUER, kind: 'hotp' },
        ]),
      ),
    });

    const chooser = dialog.getByRole('group', { name: 'Account to register' });
    await expect(chooser).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: 'Choose the account to register' }),
    ).toBeFocused();
    await expect(
      dialog.getByText('1 counter-based (HOTP) account was skipped; it cannot be imported.'),
    ).toBeVisible();
    // Sin elegir cuenta no se puede continuar.
    await expect(dialog.getByRole('button', { name: 'Use the chosen account' })).toBeDisabled();
    // Las etiquetas muestran quién es cada cuenta, nunca su clave.
    await expect(chooser.getByRole('radio', { name: `${ISSUER}: ${NAME_A}` })).toBeVisible();
    await chooser.getByRole('radio', { name: `${ISSUER}: ${NAME_B}` }).check();
    await dialog.getByRole('button', { name: 'Use the chosen account' }).click();

    await expect(chooser).toHaveCount(0);
    await expect(
      dialog.getByText(`Account that will be registered: ${ISSUER}: ${NAME_B}.`, {
        exact: false,
      }),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Register', exact: true }).click();
    await expectOutcomeConfirmingIdentity(
      page,
      rootSecret,
      dialog.getByText('Pending confirmation', { exact: true }),
    );

    // Confirmar con el código que calcula la clave de la cuenta ELEGIDA prueba que se importó la correcta.
    await dialog.getByLabel('Platform code').fill(await freshCode(base32OfText(SECRET_TEXT_B)));
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(dialog.getByText('Verified', { exact: true })).toBeVisible();

    // Ni las claves (en texto o Base32), ni el enlace, ni la cuenta descartada quedan en el navegador.
    for (const secret of [
      SECRET_TEXT_A,
      SECRET_TEXT_B,
      base32OfText(SECRET_TEXT_A),
      base32OfText(SECRET_TEXT_B),
      'otpauth://totp',
    ]) {
      expect(await leaksAnywhere(page, secret)).toBe(false);
    }
    expect(violations).toEqual([]);
  });
});

/** Abre el diálogo "Second factor" de una credencial recién importada. */
async function openSecondFactorDialog(
  page: Page,
  accountName: string,
  credentialLabel: string,
): Promise<Locator> {
  await openAccounts(page);
  await page.getByRole('link', { name: `Credentials of the account ${accountName}` }).click();
  await expect(page.getByRole('heading', { name: `Credentials of ${accountName}` })).toBeVisible();
  await page.getByRole('button', { name: `Actions for ${credentialLabel}` }).click();
  await page.getByRole('menuitem', { name: 'Second factor', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Second factor of ${credentialLabel}` });
  await expect(dialog).toBeVisible();
  return dialog;
}
