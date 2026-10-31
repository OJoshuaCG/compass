import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';

import {
  expectOutcomeConfirmingIdentity,
  signInAsRoot,
  storageDump,
  watchSecurityViolations,
} from './support/identity-helpers.js';

// Datos ficticios, solo para esta prueba.
const ACCOUNT_NAME = 'E2E Vault Account';
const CREDENTIAL_LABEL = 'Main login';
const CREDENTIAL_USERNAME = 'vault.user@e2e.test';
const INITIAL_SECRET = 'Vault-Initial-Passphrase-41';
const CHANGED_SECRET = 'Vault-Changed-Passphrase-52';
const REVEAL_REASON = 'Checking the shared login before a scheduled post';

const IMPORT_ACCOUNT_ONE = 'E2E Import Account One';
const IMPORT_ACCOUNT_TWO = 'E2E Import Account Two';
// Plataformas del catálogo global sembrado por la migración 0005 (coinciden por nombre).
const IMPORT_CSV = [
  'platform,account_name,credential_label,username,password',
  `Instagram,${IMPORT_ACCOUNT_ONE},Import login one,import.one@e2e.test,Import-One-Passphrase-63`,
  `Facebook,${IMPORT_ACCOUNT_TWO},Import login two,import.two@e2e.test,Import-Two-Passphrase-74`,
  '',
].join('\n');

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

test.describe.serial('vault journey in a real browser (accounts, credentials, import)', () => {
  // Una sola sesión para todo el recorrido: cada código TOTP nuevo puede costar hasta ~30 s de espera.
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

  test('the Root creates an account and a credential in it', async () => {
    test.setTimeout(120_000);
    await openAccounts(page);

    await page.getByRole('button', { name: 'Create account' }).click();
    const accountDialog = page.getByRole('dialog', { name: 'Create account' });
    await accountDialog.getByLabel('Platform').selectOption({ label: 'Instagram' });
    await accountDialog.getByLabel('Account name').fill(ACCOUNT_NAME);
    await accountDialog.getByRole('button', { name: 'Create account' }).click();
    await expectOutcomeConfirmingIdentity(
      page,
      rootSecret,
      page.getByText(`The account ${ACCOUNT_NAME} was created.`),
    );
    const accountsTable = page.getByRole('table', { name: 'Accounts you have access to' });
    await expect(accountsTable.getByText(ACCOUNT_NAME)).toBeVisible();

    await page.getByRole('link', { name: `Credentials of the account ${ACCOUNT_NAME}` }).click();
    await expect(
      page.getByRole('heading', { name: `Credentials of ${ACCOUNT_NAME}` }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Add credential' }).click();
    const credentialDialog = page.getByRole('dialog', { name: 'Add credential' });
    await credentialDialog.getByLabel('Credential name').fill(CREDENTIAL_LABEL);
    await credentialDialog.getByLabel('Username').fill(CREDENTIAL_USERNAME);
    await credentialDialog
      .getByRole('textbox', { name: 'Password', exact: true })
      .fill(INITIAL_SECRET);
    await credentialDialog.getByRole('button', { name: 'Save credential' }).click();
    await expectOutcomeConfirmingIdentity(
      page,
      rootSecret,
      page.getByText(`Credential ${CREDENTIAL_LABEL} added`),
    );

    const credentialsTable = page.getByRole('table', { name: 'Credentials of the account' });
    await expect(credentialsTable.getByText(CREDENTIAL_LABEL)).toBeVisible();
    // Nada sensible en el almacenamiento del navegador ni en la URL.
    expect(await storageDump(page)).not.toContain(INITIAL_SECRET);
    expect(page.url()).not.toContain(INITIAL_SECRET);
  });

  test('revealing needs a written reason, shows the password and leaves nothing behind once hidden', async () => {
    test.setTimeout(120_000);
    await page.getByRole('button', { name: `Reveal the password of ${CREDENTIAL_LABEL}` }).click();
    const dialog = page.getByRole('dialog', { name: `Reveal the password of ${CREDENTIAL_LABEL}` });
    const revealedField = dialog.getByRole('textbox', { name: 'Password', exact: true });

    // Un motivo demasiado corto se rechaza en el cliente: no llega al servidor ni cuenta para el límite por hora.
    await dialog.getByLabel('Reason').fill('abc');
    await dialog.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(
      dialog.getByText('Write a reason of 6 to 500 characters to reveal the password.'),
    ).toBeVisible();
    await expect(revealedField).toHaveCount(0);

    await dialog.getByLabel('Reason').fill(REVEAL_REASON);
    await dialog.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expectOutcomeConfirmingIdentity(page, rootSecret, revealedField);
    await expect(revealedField).toHaveValue(INITIAL_SECRET);

    await dialog.getByRole('button', { name: 'Hide now' }).click();
    await expect(
      dialog.getByText('The password was hidden. To see it again, write a new reason.'),
    ).toBeVisible();
    await expect(revealedField).toHaveCount(0);

    // Ni en el HTML ni en el valor de ningún campo; el resultado es un booleano, nunca el secreto.
    const leaked = await page.evaluate(
      (needle) =>
        document.documentElement.outerHTML.includes(needle) ||
        Array.from(document.querySelectorAll('input, textarea')).some((field) =>
          (field as HTMLInputElement | HTMLTextAreaElement).value.includes(needle),
        ),
      INITIAL_SECRET,
    );
    expect(leaked).toBe(false);
    expect(await storageDump(page)).not.toContain(INITIAL_SECRET);

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  test('changing the password adds a version and restoring the first one adds another', async () => {
    test.setTimeout(150_000);
    await page.getByRole('button', { name: `Actions for ${CREDENTIAL_LABEL}` }).click();
    await page.getByRole('menuitem', { name: 'Change password', exact: true }).click();
    const changeDialog = page.getByRole('dialog', {
      name: `Change the password of ${CREDENTIAL_LABEL}`,
    });
    await changeDialog
      .getByRole('textbox', { name: 'New password', exact: true })
      .fill(CHANGED_SECRET);
    await changeDialog.getByRole('button', { name: 'Change password', exact: true }).click();
    await expectOutcomeConfirmingIdentity(
      page,
      rootSecret,
      page.getByText(`Password of ${CREDENTIAL_LABEL} updated`),
    );

    await page.getByRole('button', { name: `Actions for ${CREDENTIAL_LABEL}` }).click();
    await page.getByRole('menuitem', { name: 'History', exact: true }).click();
    const historyDialog = page.getByRole('dialog', { name: `History of ${CREDENTIAL_LABEL}` });
    const versionsTable = historyDialog.getByRole('table', { name: 'Password versions' });
    // Solo las filas de versión (con insignia Current o Previous); la cabecera no cuenta.
    const versionRows = versionsTable.getByRole('row').filter({ hasText: /Current|Previous/ });
    await expect(versionRows).toHaveCount(2);
    await expect(versionRows.filter({ hasText: 'Current' })).toContainText('2');

    await historyDialog.getByRole('button', { name: 'Restore version 1' }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Restore version 1?' });
    await confirmDialog.getByRole('button', { name: 'Restore', exact: true }).click();
    await expectOutcomeConfirmingIdentity(
      page,
      rootSecret,
      historyDialog.getByText(
        'Version 1 was restored: it is now the current password, as a new version.',
      ),
    );

    // Restaurar no sobrescribe: crea la versión 3 y la vigente (2) pasa al historial.
    await expect(versionRows).toHaveCount(3);
    await expect(versionRows.filter({ hasText: 'Current' })).toContainText('3');
    await expect(versionRows.filter({ hasText: 'Previous' })).toHaveCount(2);

    await historyDialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(historyDialog).toBeHidden();
  });

  test('a CSV import previews, confirms with counts, and the same file is then all duplicates', async () => {
    test.setTimeout(150_000);
    await openAccounts(page);
    await page.getByRole('link', { name: 'Import from CSV' }).click();
    await expect(
      page.getByRole('heading', { name: 'Import credentials from a CSV' }),
    ).toBeVisible();

    // El archivo vive solo en memoria: no se escribe nada en disco.
    const chooseCsv = async (): Promise<void> => {
      await page.getByLabel('CSV file').setInputFiles({
        name: 'vault-import.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(IMPORT_CSV, 'utf-8'),
      });
    };

    // Primera vez: dos filas válidas y nada que omitir.
    await chooseCsv();
    const summary = page.getByRole('region', { name: 'File summary' });
    await expectOutcomeConfirmingIdentity(page, rootSecret, summary);
    await expect(summaryCount(summary, 'Rows')).toHaveText('2');
    await expect(summaryCount(summary, 'Valid')).toHaveText('2');
    await expect(summaryCount(summary, 'Invalid')).toHaveText('0');
    await expect(summaryCount(summary, 'Duplicates (skipped)')).toHaveText('0');
    await expect(
      page.getByText('The file is valid. Review the rows and confirm to import them.'),
    ).toBeVisible();

    const previewTable = page.getByRole('table', { name: 'Preview of the rows in the file' });
    await expect(
      previewTable.getByRole('row').filter({ hasText: IMPORT_ACCOUNT_ONE }),
    ).toContainText('Valid');
    await expect(
      previewTable.getByRole('row').filter({ hasText: IMPORT_ACCOUNT_TWO }),
    ).toContainText('Valid');

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const result = page.getByRole('region', { name: 'Import result' });
    await expectOutcomeConfirmingIdentity(page, rootSecret, result);
    await expect(page.getByText('Import complete.')).toBeVisible();
    await expect(summaryCount(result, 'Accounts created')).toHaveText('2');
    await expect(summaryCount(result, 'Credentials created')).toHaveText('2');
    await expect(summaryCount(result, 'Duplicates skipped')).toHaveText('0');

    // Segunda vez: las cuentas ya existen, así que todo sale duplicado y no hay nada que crear.
    await page.getByRole('button', { name: 'Import another file' }).click();
    await chooseCsv();
    await expectOutcomeConfirmingIdentity(page, rootSecret, summary);
    await expect(summaryCount(summary, 'Rows')).toHaveText('2');
    await expect(summaryCount(summary, 'Valid')).toHaveText('0');
    await expect(summaryCount(summary, 'Invalid')).toHaveText('0');
    await expect(summaryCount(summary, 'Duplicates (skipped)')).toHaveText('2');
    await expect(
      page.getByText('There are no new rows to import: every row is a duplicate.'),
    ).toBeVisible();
    await expect(previewTable.getByRole('row').filter({ hasText: 'Duplicate' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

    expect(violations).toEqual([]);
  });
});
