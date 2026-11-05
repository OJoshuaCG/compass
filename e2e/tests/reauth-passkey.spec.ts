import { expect, test } from '@playwright/test';

import {
  ROOT_EMAIL,
  ROOT_PASSWORD,
  freshCode,
  signInAsRoot,
  signInWithPassword,
  watchSecurityViolations,
} from './support/identity-helpers.js';

// ADR 0033: la reautenticación acepta un código TOTP o una passkey a elección de la persona.
test('a sensitive action can be re-authenticated with a passkey instead of a code', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  // Autenticador virtual del propio Chrome (el mismo patrón de `identity.spec.ts`): hace de llave
  // con verificación de usuario y conserva sus llaves mientras dure el contexto, también entre sesiones.
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const violations = watchSecurityViolations(page);

  // Primera llave: aún no hay ninguna, así que la reautenticación se hace con el código.
  const rootSecret = await signInAsRoot(page);
  await page.getByRole('link', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
  await page.getByRole('button', { name: 'Add passkey' }).click();
  await page.getByLabel('Passkey name').fill('Reauth first key');
  await page.getByRole('button', { name: 'Continue' }).click();
  const codeDialog = page.getByRole('dialog', { name: 'Confirm your identity' });
  await expect(codeDialog).toBeVisible();
  await codeDialog.getByLabel('Verification code').fill(await freshCode(rootSecret));
  await codeDialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('The passkey Reauth first key was added.')).toBeVisible();

  // Sesión nueva: iniciar sesión no cuenta como reautenticación reciente, y la persona ya tiene llave.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await signInWithPassword(page, ROOT_EMAIL, ROOT_PASSWORD);
  await page.getByRole('button', { name: 'Use a passkey' }).click();
  await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();

  await page.getByRole('link', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Add passkey' }).click();
  await page.getByLabel('Passkey name').fill('Reauth second key');
  await page.getByRole('button', { name: 'Continue' }).click();

  // La acción sensible pide confirmar la identidad y ahora ofrece la llave junto al código.
  const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Use a passkey' }).click();

  // Sin escribir ningún código, la acción termina y el diálogo se cierra.
  await expect(page.getByText('The passkey Reauth second key was added.')).toBeVisible();
  await expect(dialog).toBeHidden();
  const table = page.getByRole('table', { name: 'Your passkeys' });
  await expect(table.getByText('Reauth first key')).toBeVisible();
  await expect(table.getByText('Reauth second key')).toBeVisible();
  expect(violations).toEqual([]);
});
