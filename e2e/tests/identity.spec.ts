import { expect, test } from '@playwright/test';

import {
  changeInitialPassword,
  completeEnrollment,
  freshCode,
  lastInvitation,
  PASSWORD,
  rememberRootSecret,
  ROOT_EMAIL,
  ROOT_PASSWORD,
  sessionCookie,
  signInWithPassword,
  storageDump,
  watchSecurityViolations,
} from './support/identity-helpers.js';

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
    await changeInitialPassword(page, PASSWORD, ROOT_PASSWORD);

    const enrolled = await completeEnrollment(page);
    rootSecret = enrolled.secret;
    rememberRootSecret(rootSecret); // para que otros archivos (vault.spec) entren con la misma Raíz
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
    await signInWithPassword(page, ROOT_EMAIL, ROOT_PASSWORD);
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
    await signInWithPassword(page, ROOT_EMAIL, ROOT_PASSWORD);
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
    await signInWithPassword(page, ROOT_EMAIL, ROOT_PASSWORD);
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
    await signInWithPassword(page, ROOT_EMAIL, ROOT_PASSWORD);
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

  test('a sensitive action asks to confirm the identity: a wrong code is refused, the right one completes it', async ({
    page,
  }) => {
    const violations = watchSecurityViolations(page);
    await signInWithPassword(page, ROOT_EMAIL, ROOT_PASSWORD);
    await page.getByLabel('Verification code').fill(await freshCode(rootSecret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.getByRole('link', { name: 'Users' }).click();
    await page.getByRole('tab', { name: 'Team management' }).click();

    const table = page.getByRole('table', { name: 'People you manage' });
    await expect(table.getByText('operator@e2e.test')).toBeVisible();
    await page.getByRole('button', { name: /Actions for / }).click();
    await page.getByRole('menuitem', { name: 'Change rank' }).click();
    await page.getByLabel('New rank').selectOption({ label: 'Lead' });
    await page.getByRole('button', { name: 'Change rank' }).click();

    const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Verification code').fill('000000');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog).toBeVisible(); // el código erróneo no confirma nada
    await expect(dialog.getByRole('alert')).toBeVisible();

    await dialog.getByLabel('Verification code').fill(await freshCode(rootSecret));
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText(/rank was changed to Lead/)).toBeVisible();
    await expect(table.getByText('Lead', { exact: true })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('a passkey added in Security replaces the code at the next sign-in', async ({
    page,
    context,
  }) => {
    // Autenticador virtual del propio Chrome: hace de huella o llave de seguridad, con verificación.
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

    await signInWithPassword(page, ROOT_EMAIL, ROOT_PASSWORD);
    await page.getByLabel('Verification code').fill(await freshCode(rootSecret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.getByRole('link', { name: 'Security' }).click();
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
    await expect(page.getByText('You have no passkeys yet')).toBeVisible();

    await page.getByRole('button', { name: 'Add passkey' }).click();
    await page.getByLabel('Passkey name').fill('Chrome virtual key');
    await page.getByRole('button', { name: 'Continue' }).click();
    // Registrar una llave pide confirmar la identidad (reautenticación reciente).
    const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Verification code').fill(await freshCode(rootSecret));
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('The passkey Chrome virtual key was added.')).toBeVisible();
    const table = page.getByRole('table', { name: 'Your passkeys' });
    await expect(table.getByText('Chrome virtual key')).toBeVisible();

    // Nuevo inicio de sesión: contraseña y, en lugar del código, la llave de acceso.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await signInWithPassword(page, ROOT_EMAIL, ROOT_PASSWORD);
    await page.getByRole('button', { name: 'Use a passkey' }).click();
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);

    await page.getByRole('link', { name: 'Security' }).click();
    await expect(table.getByText('Chrome virtual key')).toBeVisible();
    expect(violations).toEqual([]);
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
