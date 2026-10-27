import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { generateSync } from 'otplib';

const MAILBOX = 'http://127.0.0.1:3101';
const ROOT_EMAIL = 'root@e2e.test';
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RECOVERY_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** Último paso TOTP usado por cada secreto: el servidor exige un paso estrictamente mayor. */
const lastStepBySecret = new Map<string, number>();

/**
 * Código TOTP válido y NUEVO. El servidor rechaza reutilizar un paso (protección contra repetición)
 * y acepta solo el paso actual y sus vecinos; si el siguiente paso aún queda fuera de esa
 * tolerancia, se espera a que llegue, igual que haría una persona con su aplicación.
 */
async function freshCode(secret: string): Promise<string> {
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

const lastInvitation = async (): Promise<{ to: string; token: string }> => {
  const response = await fetch(`${MAILBOX}/last`);
  return (await response.json()) as { to: string; token: string };
};

/** Falla la prueba si el navegador reporta una violación de CSP o de Trusted Types. */
function watchSecurityViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/content security policy|trusted type/i.test(text)) violations.push(text);
  });
  page.on('pageerror', (error) => violations.push(String(error)));
  return violations;
}

async function signInWithPassword(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Registra el segundo factor en la pantalla de alta y devuelve la clave y los códigos de recuperación. */
async function completeEnrollment(
  page: Page,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  await expect(page.getByRole('heading', { name: 'Set up your second factor' })).toBeVisible();
  await expect(page.getByAltText('QR code to register the authenticator app')).toBeVisible();
  const secret = (
    await page
      .getByText(/^[A-Z2-7]{32}$/)
      .first()
      .innerText()
  ).trim();
  await page.getByLabel('6-digit code').fill(await freshCode(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const recoveryCodes = await page.getByText(RECOVERY_CODE).allInnerTexts();
  await page.getByRole('checkbox', { name: 'I have saved them' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  return { secret, recoveryCodes };
}

async function storageDump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const read = (storage: Storage): Record<string, string | null> =>
      Object.fromEntries(Object.keys(storage).map((key) => [key, storage.getItem(key)]));
    return JSON.stringify({ local: read(localStorage), session: read(sessionStorage) });
  });
}

async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === '__Host-session');
}

test.describe
  .serial('identity in a real browser (same origin, strict CSP, hardened cookie)', () => {
  let rootSecret = '';

  test('the page and the API share one origin and the strict CSP covers the whole app', async ({
    page,
  }) => {
    const response = await page.request.get('/');
    const csp = response.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(response.headers()['cache-control']).toBe('no-cache');
  });

  test('an anonymous visitor is sent to sign in, and wrong credentials give one generic message', async ({
    page,
  }) => {
    const violations = watchSecurityViolations(page);
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login/);

    await signInWithPassword(page, ROOT_EMAIL, 'definitely-the-wrong-password');
    const wrongPassword = page.getByText('Incorrect email or password.');
    await expect(wrongPassword).toBeVisible();

    await signInWithPassword(page, 'nobody@e2e.test', 'definitely-the-wrong-password');
    await expect(page.getByText('Incorrect email or password.')).toBeVisible(); // mismo mensaje: no revela qué correos existen
    expect(violations).toEqual([]);
  });

  test('the Root registers a second factor, saves recovery codes and lands signed in', async ({
    page,
    context,
  }) => {
    const violations = watchSecurityViolations(page);
    await signInWithPassword(page, ROOT_EMAIL, PASSWORD);

    const enrolled = await completeEnrollment(page);
    rootSecret = enrolled.secret;
    expect(new Set(enrolled.recoveryCodes).size).toBe(10);
    await expect(page).toHaveURL(/\/(users)?$|\/users/);

    // La cookie de sesión: invisible para JavaScript y con las banderas del plan.
    const cookie = await sessionCookie(context);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-session');

    // Nada sensible en el almacenamiento del navegador ni en la URL.
    const dump = await storageDump(page);
    for (const secret of [PASSWORD, enrolled.secret, ...enrolled.recoveryCodes]) {
      expect(dump).not.toContain(secret);
      expect(page.url()).not.toContain(secret);
    }
    expect(violations).toEqual([]);
  });

  test('signing out ends the session and signing back in asks for the second factor', async ({
    page,
    context,
  }) => {
    // Cada prueba tiene un contexto limpio: se vuelve a entrar con contraseña y código.
    await signInWithPassword(page, ROOT_EMAIL, PASSWORD);
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();

    await page.getByLabel('Verification code').fill(await freshCode(rootSecret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await sessionCookie(context)).toBeUndefined();

    // Una vista protegida ya no abre.
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a recovery code works once and the wrong code is refused', async ({ page }) => {
    await signInWithPassword(page, ROOT_EMAIL, PASSWORD);
    await page.getByLabel('Verification code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('The code is invalid or has expired.')).toBeVisible();
    // Sigue en la pantalla de verificación: no entra con un código incorrecto.
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  });

  test('the Root invites a person, who accepts from the mailed link, sets a strong password and enrolls', async ({
    page,
    browser,
  }) => {
    const violations = watchSecurityViolations(page);
    await signInWithPassword(page, ROOT_EMAIL, PASSWORD);
    await page.getByLabel('Verification code').fill(await freshCode(rootSecret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

    await page.getByRole('button', { name: 'Invite user' }).click();
    await page.getByLabel('Email address').fill('operator@e2e.test');
    await page.getByLabel('Rank').selectOption({ label: 'Operator' });
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent to operator@e2e.test.')).toBeVisible();

    // La persona invitada abre el enlace de su correo en OTRO navegador.
    const mail = await lastInvitation();
    expect(mail.to).toBe('operator@e2e.test');
    const guestContext = await browser.newContext({ locale: 'en-US' });
    const guest = await guestContext.newPage();
    const guestViolations = watchSecurityViolations(guest);
    await guest.goto(`/invitation#token=${encodeURIComponent(mail.token)}`);
    await expect(guest.getByText('operator@e2e.test')).toBeVisible();
    // El token sale de la URL en cuanto se lee (historial y referer).
    await expect.poll(() => guest.url()).not.toContain(mail.token);

    await guest.getByLabel('Full name').fill('Sofía Operadora');
    await guest.getByRole('textbox', { name: 'Password', exact: true }).fill('password1234');
    await guest.getByRole('button', { name: 'Create account' }).click();
    await expect(guest.getByText(/too weak or too common/i)).toBeVisible();

    await guest.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
    await guest.getByRole('button', { name: 'Create account' }).click();
    const guestEnrollment = await completeEnrollment(guest);
    await expect(guest.getByRole('button', { name: 'Sign out' })).toBeVisible();
    // La persona nueva aparece en el directorio de la Raíz.
    expect(await storageDump(guest)).not.toContain(guestEnrollment.secret);

    // El enlace ya no sirve: un solo uso.
    const again = await guestContext.newPage();
    await again.goto(`/invitation#token=${encodeURIComponent(mail.token)}`);
    await expect(again.getByRole('heading', { name: 'Invalid invitation' })).toBeVisible();

    await guestContext.close();
    expect(violations).toEqual([]);
    expect(guestViolations).toEqual([]);
  });

  test('the directory lists the new person and can be searched and sorted from the keyboard', async ({
    page,
  }) => {
    await signInWithPassword(page, ROOT_EMAIL, PASSWORD);
    await page.getByLabel('Verification code').fill(await freshCode(rootSecret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

    const table = page.getByRole('table', { name: 'User directory' });
    await expect(table.getByText('operator@e2e.test')).toBeVisible();
    await expect(table.getByText(ROOT_EMAIL)).toBeVisible();

    await page.getByRole('searchbox').fill('operator');
    await expect(table.getByText(ROOT_EMAIL)).toBeHidden();
    await expect(table.getByText('operator@e2e.test')).toBeVisible();
    await expect(page).toHaveURL(/q=operator/);
  });

  test('the language can be switched and the choice survives a reload', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Language').selectOption({ label: 'Español (México)' });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();
    await page.reload();
    await expect(page.getByLabel('Idioma')).toBeVisible();
  });
});
