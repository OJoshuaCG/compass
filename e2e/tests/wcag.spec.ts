import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

import {
  expectOutcomeConfirmingIdentity,
  signInAsRoot,
  watchSecurityViolations,
} from './support/identity-helpers.js';

// Datos ficticios, solo para esta prueba.
const ACCOUNT_NAME = 'E2E Wcag Account';

// Criterios WCAG 2.0, 2.1 y 2.2 de nivel A y AA. No se excluye ninguna regla ni selector: un falso
// positivo se reporta como hallazgo y se decide aparte, nunca se oculta aquí.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Máximo de selectores por regla en el mensaje, para que el reporte siga siendo legible. */
const MAX_TARGETS_PER_RULE = 5;

/**
 * Analiza la pantalla actual y falla con un resumen legible: regla, impacto y selectores.
 * Nunca imprime el HTML de los nodos ni sus textos, porque pueden contener datos sensibles.
 */
async function expectNoWcagViolations(page: Page, screenName: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const report = results.violations.map((violation) => {
    const targets = violation.nodes
      .slice(0, MAX_TARGETS_PER_RULE)
      .map((node) => node.target.join(' '))
      .join(' | ');
    const hiddenCount = Math.max(0, violation.nodes.length - MAX_TARGETS_PER_RULE);
    const extra = hiddenCount > 0 ? ` (+${String(hiddenCount)} more)` : '';
    return `${violation.id} [${violation.impact ?? 'unknown'}] ${String(violation.nodes.length)} node(s): ${targets}${extra}`;
  });
  expect(report, `WCAG violations on "${screenName}":\n${report.join('\n')}`).toEqual([]);
}

/** Espera a que la pantalla termine de cargar sus datos antes de analizarla. */
async function waitForScreen(page: Page, heading: string): Promise<void> {
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test.describe('WCAG 2.2 A/AA scan with axe in a real browser (anonymous)', () => {
  test('sign-in screen, English and Spanish', async ({ page }) => {
    const violations = watchSecurityViolations(page);
    await page.goto('/login');
    await waitForScreen(page, 'Sign in');
    await expectNoWcagViolations(page, 'Sign in (en-US)');

    await page.getByLabel('Language').selectOption({ label: 'Español (México)' });
    await waitForScreen(page, 'Iniciar sesión');
    await expectNoWcagViolations(page, 'Iniciar sesión (es-MX)');
    expect(violations).toEqual([]);
  });
});

test.describe.serial('WCAG 2.2 A/AA scan with axe in a real browser (signed in as Root)', () => {
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

  test('users directory (en-US)', async () => {
    await page.getByRole('link', { name: 'People', exact: true }).click();
    await waitForScreen(page, 'Users');
    await expectNoWcagViolations(page, 'Users (en-US)');
  });

  test('accounts (en-US)', async () => {
    await page.getByRole('link', { name: 'Vault', exact: true }).click();
    await waitForScreen(page, 'Accounts');
    await expectNoWcagViolations(page, 'Accounts (en-US)');
  });

  test('security (en-US)', async () => {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await waitForScreen(page, 'Security');
    await expectNoWcagViolations(page, 'Security (en-US)');
  });

  test('credentials of an account (en-US)', async () => {
    test.setTimeout(120_000);
    await page.getByRole('link', { name: 'Vault', exact: true }).click();
    await waitForScreen(page, 'Accounts');

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

    await page.getByRole('link', { name: `Credentials of the account ${ACCOUNT_NAME}` }).click();
    await waitForScreen(page, `Credentials of ${ACCOUNT_NAME}`);
    await expectNoWcagViolations(page, 'Credentials of an account (en-US)');
  });

  test('users directory, accounts and security (es-MX)', async () => {
    await page.getByLabel('Language').selectOption({ label: 'Español (México)' });

    await page.getByRole('link', { name: 'Usuarios', exact: true }).click();
    await waitForScreen(page, 'Usuarios');
    await expectNoWcagViolations(page, 'Usuarios (es-MX)');

    await page.getByRole('link', { name: 'Cuentas', exact: true }).click();
    await waitForScreen(page, 'Cuentas');
    await expectNoWcagViolations(page, 'Cuentas (es-MX)');

    await page.getByRole('link', { name: 'Seguridad', exact: true }).click();
    await waitForScreen(page, 'Seguridad');
    await expectNoWcagViolations(page, 'Seguridad (es-MX)');

    expect(violations).toEqual([]);
  });
});
