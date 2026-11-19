import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

import {
  expectOutcomeConfirmingIdentity,
  signInAsRoot,
  watchSecurityViolations,
} from './support/identity-helpers.js';

// Validación responsive obligatoria (docs/frontend.md §4.4): la app se usa desde teléfono, así que cada
// pantalla debe caber en 375 px sin scroll horizontal de la página y sus campos de texto deben medir 16 px
// o más (por debajo, iOS hace zoom al enfocar).
const PHONE_VIEWPORT = { width: 375, height: 812 };
const MIN_TEXT_FIELD_FONT_PX = 16;
// Margen de subpíxeles al comparar anchos de desplazamiento.
const SCROLL_WIDTH_TOLERANCE_PX = 1;

// Controles táctiles de 40 px en móvil (docs/frontend.md §4.4); la tolerancia absorbe subpíxeles.
const MIN_TOUCH_TARGET_PX = 40;
const TOUCH_TARGET_TOLERANCE_PX = 0.5;
// Otros anchos que deben seguir sin scroll horizontal de la página: tableta y teléfono en horizontal.
const OTHER_VIEWPORTS = [
  { name: 'tablet 768', width: 768, height: 1024 },
  { name: 'phone landscape 812', width: 812, height: 375 },
];

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
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      windowWidth: window.innerWidth,
      // Quién se sale por la derecha: facilita encontrar el elemento que ensancha la página.
      culprits: Array.from(document.body.querySelectorAll<HTMLElement>('*'))
        .filter((element) => element.getBoundingClientRect().right > root.clientWidth + 1)
        .slice(0, 6)
        .map((element) => {
          const box = element.getBoundingClientRect();
          return `${element.tagName.toLowerCase()}.${(element.getAttribute('class') ?? '').slice(0, 60)} right=${String(Math.round(box.right))}`;
        }),
    };
  });
  expect(
    widths.scrollWidth,
    `Horizontal page scroll on "${screenName}" at ${String(widths.windowWidth)}px; overflowing: ${widths.culprits.join(' | ')}`,
  ).toBeLessThanOrEqual(widths.clientWidth + SCROLL_WIDTH_TOLERANCE_PX);
}

/** Con la tabla en tarjetas (docs/frontend.md §6.2) ninguna región de tabla debe desbordar a 375 px. */
async function expectNoTableRegionOverflow(page: Page, screenName: string): Promise<void> {
  const overflowing = await page.evaluate((tolerancePx) => {
    const regions = Array.from(
      // Todas las regiones, no solo las enfocables: la tabla solo se vuelve enfocable cuando desborda.
      document.querySelectorAll<HTMLElement>('table[role="table"]'),
    );
    return regions
      .map((table) => table.parentElement)
      .filter((region): region is HTMLElement => region !== null)
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

/** Todo control visible (botón, pestaña, selector, campo) debe medir al menos 40 px de alto en móvil. */
async function expectTouchTargetsLargeEnough(page: Page, screenName: string): Promise<void> {
  const tooSmall = await page.evaluate(
    ({ minimumPx, tolerancePx }) => {
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, [role="tab"], select, input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file])',
        ),
      );
      return controls
        .filter(
          (control) =>
            control.offsetParent !== null || getComputedStyle(control).position === 'fixed',
        )
        .filter((control) => control.closest('[aria-hidden="true"]') === null)
        .filter((control) => !control.matches('.sr-only') && control.closest('.sr-only') === null)
        .map((control) => ({ control, box: control.getBoundingClientRect() }))
        .filter(({ box }) => box.height > 0 && box.height + tolerancePx < minimumPx)
        .map(
          ({ control, box }) =>
            `${control.tagName.toLowerCase()} "${(control.getAttribute('aria-label') ?? control.textContent).trim().slice(0, 30)}" ${String(Math.round(box.height))}px`,
        );
    },
    { minimumPx: MIN_TOUCH_TARGET_PX, tolerancePx: TOUCH_TARGET_TOLERANCE_PX },
  );
  expect(
    tooSmall,
    `Touch targets under ${String(MIN_TOUCH_TARGET_PX)}px on "${screenName}"`,
  ).toEqual([]);
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
  let rootSecret: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    context = await browser.newContext({ locale: 'en-US' });
    page = await context.newPage();
    violations = watchSecurityViolations(page);
    // El inicio de sesión espera el menú lateral visible, que en 375 px nace plegado: se entra con el
    // tamaño por defecto y se reduce la ventana después.
    rootSecret = await signInAsRoot(page);
    await page.setViewportSize(PHONE_VIEWPORT);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('every screen fits without horizontal page scroll and has 16px text fields', async () => {
    test.setTimeout(180_000);
    for (const route of SIGNED_IN_ROUTES) {
      await page.goto(route);
      // Algunas pantallas (p. ej. /alerts) piden confirmar la identidad al cargar: se responde y se sigue.
      await expectOutcomeConfirmingIdentity(
        page,
        rootSecret,
        page.getByRole('heading', { level: 1 }).first(),
      );
      await page.waitForLoadState('networkidle');
      // Mide las tablas ya cargadas, no sus esqueletos.
      await expect(page.locator('table[aria-busy="true"]')).toHaveCount(0);
      await expectNoHorizontalPageScroll(page, route);
      await expectNoTableRegionOverflow(page, route);
      await expectTextFieldsAtLeastSixteenPixels(page, route);
      await expectTouchTargetsLargeEnough(page, route);
    }
    expect(violations).toEqual([]);
  });

  test('every screen fits without horizontal page scroll at tablet and landscape widths', async () => {
    test.setTimeout(240_000);
    for (const viewport of OTHER_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of SIGNED_IN_ROUTES) {
        await page.goto(route);
        await expectOutcomeConfirmingIdentity(
          page,
          rootSecret,
          page.getByRole('heading', { level: 1 }).first(),
        );
        await page.waitForLoadState('networkidle');
        await expect(page.locator('table[aria-busy="true"]')).toHaveCount(0);
        await expectNoHorizontalPageScroll(page, `${route} (${viewport.name})`);
      }
    }
    await page.setViewportSize(PHONE_VIEWPORT);
  });

  test('the SSO invalid-request state fits at phone, tablet and landscape widths', async () => {
    test.setTimeout(120_000);
    // Sin `uid` ambas pantallas muestran el estado de solicitud inválida: es alcanzable sin pila OIDC.
    // El flujo con solicitud real (formulario TOTP, consentimiento) no se puede montar sin un proveedor.
    const viewports = [{ name: 'phone 375', ...PHONE_VIEWPORT }, ...OTHER_VIEWPORTS];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of ['/sso/reauth', '/sso/consent']) {
        await page.goto(route);
        await expect(
          page.getByRole('heading', { level: 1, name: 'This request is not valid' }),
        ).toBeVisible();
        const screenName = `${route} invalid request (${viewport.name})`;
        await expectNoHorizontalPageScroll(page, screenName);
        await expectTouchTargetsLargeEnough(page, screenName);
      }
    }
    await page.setViewportSize(PHONE_VIEWPORT);
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
