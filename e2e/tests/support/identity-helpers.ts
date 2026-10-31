import { expect } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { generateSync } from 'otplib';

/**
 * Ayudantes compartidos de los recorridos e2e: crear sesión, activar y usar el segundo factor.
 * Los usan `identity.spec.ts` y `vault.spec.ts`; el comportamiento es el que tenía identity.
 */

export const MAILBOX = 'http://127.0.0.1:3101';
export const ROOT_EMAIL = 'root@e2e.test';
export const PASSWORD = 'Correct-Horse-Battery-Staple-9';
/** La contraseña inicial de la Raíz es de un solo uso: se cambia en su primer ingreso. */
export const ROOT_PASSWORD = 'Another-Strong-Passphrase-77';
export const RECOVERY_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** Último paso TOTP usado por cada secreto: el servidor exige un paso estrictamente mayor. */
const lastStepBySecret = new Map<string, number>();

/**
 * Código TOTP válido y NUEVO. El servidor rechaza reutilizar un paso (protección contra repetición)
 * y acepta solo el paso actual y sus vecinos; si el siguiente paso aún queda fuera de esa
 * tolerancia, se espera a que llegue, igual que haría una persona con su aplicación.
 */
export async function freshCode(secret: string): Promise<string> {
  for (;;) {
    const current = Math.floor(Date.now() / 30_000);
    const candidate = Math.max((lastStepBySecret.get(secret) ?? -1) + 1, current);
    if (candidate <= current + 1) {
      lastStepBySecret.set(secret, candidate);
      return generateSync({ secret, strategy: 'totp', epoch: candidate * 30 });
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * Clave TOTP de la Raíz, compartida entre archivos de prueba del mismo trabajador. La pila e2e es
 * una sola y la Raíz solo se registra una vez: quien la registre primero deja aquí su clave para que
 * los demás archivos (p. ej. `vault.spec.ts`, que corre después de `identity.spec.ts`) entren con ella.
 */
let knownRootSecret: string | undefined;

export function rememberRootSecret(secret: string): void {
  knownRootSecret = secret;
}

export function recalledRootSecret(): string | undefined {
  return knownRootSecret;
}

export const lastInvitation = async (): Promise<{ to: string; token: string }> => {
  const response = await fetch(`${MAILBOX}/last`);
  return (await response.json()) as { to: string; token: string };
};

/** Falla la prueba si el navegador reporta una violación de CSP o de Trusted Types. */
export function watchSecurityViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/content security policy|trusted type/i.test(text)) violations.push(text);
  });
  page.on('pageerror', (error) => violations.push(String(error)));
  return violations;
}

export async function signInWithPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Pantalla de cambio obligatorio: sustituye la contraseña inicial por una propia. */
export async function changeInitialPassword(
  page: Page,
  current: string,
  next: string,
): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Current password', exact: true }).fill(current);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill(next);
  await page.getByRole('button', { name: 'Change password' }).click();
}

/** Registra el segundo factor en la pantalla de alta y devuelve la clave y los códigos de recuperación. */
export async function completeEnrollment(
  page: Page,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  await expect(page.getByRole('heading', { name: 'Set up your second factor' })).toBeVisible();
  await expect(page.getByAltText('QR code to register the authenticator app')).toBeVisible();
  // La clave se muestra en un campo de solo lectura (así los gestores de contraseñas no la capturan),
  // por eso se lee su valor y no su texto.
  const secret = (await page.getByLabel('Setup key').inputValue()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('6-digit code').fill(await freshCode(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const recoveryCodes = await page.getByText(RECOVERY_CODE).allInnerTexts();
  await page.getByRole('checkbox', { name: 'I have saved them' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  return { secret, recoveryCodes };
}

export async function storageDump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const read = (storage: Storage): Record<string, string | null> =>
      Object.fromEntries(Object.keys(storage).map((key) => [key, storage.getItem(key)]));
    return JSON.stringify({ local: read(localStorage), session: read(sessionStorage) });
  });
}

export async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === '__Host-session');
}

/**
 * Entra como la Raíz. Si `identity.spec.ts` ya corrió en este trabajador, la Raíz ya está registrada
 * y su clave quedó recordada: se entra con contraseña y código. Si este archivo corre solo, la
 * organización es nueva: se cambia la contraseña inicial y se registra el segundo factor.
 */
export async function signInAsRoot(page: Page): Promise<string> {
  const knownSecret = recalledRootSecret();
  if (knownSecret === undefined) {
    await signInWithPassword(page, ROOT_EMAIL, PASSWORD);
    await changeInitialPassword(page, PASSWORD, ROOT_PASSWORD);
    const enrolled = await completeEnrollment(page);
    rememberRootSecret(enrolled.secret);
    await expect(page.getByRole('link', { name: 'Accounts', exact: true })).toBeVisible();
    return enrolled.secret;
  }
  await signInWithPassword(page, ROOT_EMAIL, ROOT_PASSWORD);
  await page.getByLabel('Verification code').fill(await freshCode(knownSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('link', { name: 'Accounts', exact: true })).toBeVisible();
  return knownSecret;
}

/**
 * Espera el resultado de una acción sensible. Si antes aparece "Confirm your identity" (el cliente
 * HTTP pide reautenticar y reintenta solo), responde con un código nuevo y luego espera el resultado.
 * `outcome` debe ser algo que NO exista hasta que la acción termine: así nunca coincide con el diálogo.
 */
export async function expectOutcomeConfirmingIdentity(
  page: Page,
  secret: string,
  outcome: Locator,
): Promise<void> {
  const reauth = page.getByRole('dialog', { name: 'Confirm your identity' });
  await expect(outcome.or(reauth)).toBeVisible();
  if (await reauth.isVisible()) {
    await reauth.getByLabel('Verification code').fill(await freshCode(secret));
    await reauth.getByRole('button', { name: 'Confirm' }).click();
    await expect(outcome).toBeVisible();
  }
}
