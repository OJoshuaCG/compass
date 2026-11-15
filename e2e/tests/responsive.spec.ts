import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

import { signInAsRoot, watchSecurityViolations } from './support/identity-helpers.js';

// Validación responsive obligatoria (docs/frontend.md §4.4): la app se usa desde teléfono, así que cada
// pantalla debe caber en 375 px sin scroll horizontal de la página y sus campos de texto deben medir 16 px
// o más (por debajo, iOS hace zoom al enfocar).
const PHONE_VIEWPORT = { width: 375, height: 812 };
const MIN_TEXT_FIELD_FONT_PX = 16;
// Margen de subpíxeles al comparar anchos de desplazamiento.
const SCROLL_WIDTH_TOLERANCE_PX = 1;

const SIGNED_IN_ROUTES = [
  '/',
  '/users',
  '/accounts',
  '/groups',
  '/roles',
  '/sessions',
  '/security',
  '/alerts',
  '/credential-health',
  '/inbound',
];

/** El ancho desplazable de la página no puede superar el de la ventana: eso sería scroll horizontal. */
async function expectNoHorizontalPageScroll(page: Page, screenName: string): Promise<void> {
  const widths = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(
    widths.scrollWidth,
    `Horizontal page scroll on "${screenName}" at ${String(PHONE_VIEWPORT.width)}px`,
  ).toBeLessThanOrEqual(widths.clientWidth + SCROLL_WIDTH_TOLERANCE_PX);
}

/** Con la tabla en tarjetas (docs/frontend.md §6.2) ninguna región de tabla debe desbordar a 375 px. */
async function expectNoTableRegionOverflow(page: Page, screenName: string): Promise<void> {
  const overflowing = await page.evaluate((tolerancePx) => {
    const regions = Array.from(
      document.querySelectorAll<HTMLElement>('[role="region"][tabindex="0"]'),
    );
    return regions
      .filter((region) => region.scrollWidth > region.clientWidth + tolerancePx)
      .map((region) => region.getAttribute('aria-label') ?? 'region');
  }, SCROLL_WIDTH_TOLERANCE_PX);
  expect(overflowing, `Table region overflow on "${screenName}"`).toEqual([]);
}

/** Todo campo de texto visible debe medir al menos 16 px para que iOS no haga zoom al enfocarlo. */
async function expectTextFieldsAtLeastSixteenPixels(page: Page, screenName: string): Promise<void> {
  const tooSmall = await page.evaluate((minimumPx) => {
    const fields = Array.from(
      document.querySelectorAll<HTMLElement>(
        'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=range]):not([type=color]), select, textarea',
      ),
    );
    return fields
      .filter((field) => field.offsetParent !== null)
      .filter((field) => parseFloat(getComputedStyle(field).fontSize) < minimumPx)
      .map((field) => field.getAttribute('name') ?? field.getAttribute('type') ?? field.tagName);
  }, MIN_TEXT_FIELD_FONT_PX);
  expect(tooSmall, `Text fields under 16px on "${screenName}"`).toEqual([]);
}

test.describe('Responsive at phone width (anonymous)', () => {
  test.use({ viewport: PHONE_VIEWPORT });

  test('sign-in screen fits without horizontal scroll, English and Spanish', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expectNoHorizontalPageScroll(page, 'Sign in (en-US)');
    await expectTextFieldsAtLeastSixteenPixels(page, 'Sign in (en-US)');

    await page.getByRole('button', { name: /Switch to Español \(México\)/ }).click();
    await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toBeVisible();
    await expectNoHorizontalPageScroll(page, 'Iniciar sesión (es-MX)');
  });
});

test.describe.serial('Responsive at phone width (signed in as Root)', () => {
  // Una sola sesión: cada código TOTP nuevo puede costar hasta ~30 s de espera.
  let context: BrowserContext;
  let page: Page;
  let violations: string[];

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    context = await browser.newContext({ locale: 'en-US' });
    page = await context.newPage();
    violations = watchSecurityViolations(page);
    // El inicio de sesión espera el menú lateral visible, que en 375 px nace plegado: se entra con el
    // tamaño por defecto y se reduce la ventana después.
    await signInAsRoot(page);
    await page.setViewportSize(PHONE_VIEWPORT);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('every screen fits without horizontal page scroll and has 16px text fields', async () => {
    test.setTimeout(180_000);
    for (const route of SIGNED_IN_ROUTES) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      // Mide las tablas ya cargadas, no sus esqueletos.
      await expect(page.locator('table[aria-busy="true"]')).toHaveCount(0);
      await expectNoHorizontalPageScroll(page, route);
      await expectNoTableRegionOverflow(page, route);
      await expectTextFieldsAtLeastSixteenPixels(page, route);
    }
    expect(violations).toEqual([]);
  });

  test('the menu opens as a drawer over the content, navigates and closes', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Main navigation' });
    await expect(drawer).toBeVisible();
    await expectNoHorizontalPageScroll(page, 'open drawer');

    // Escape lo cierra y el foco vuelve al botón que lo abrió.
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show menu' })).toBeFocused();

    // Elegir una sección navega y cierra el panel.
    await page.getByRole('button', { name: 'Show menu' }).click();
    await drawer.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(violations).toEqual([]);
  });
});
