import type { AlertSettings, Permission } from '@iam/contracts';
import { loadIntegrationsCatalog, resources } from '@iam/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const PAGE = '/alerts';
const SETTINGS_PATH = '/integrations/alert-settings';
const PERMISSIONS: Permission[] = ['alerts.infra.manage'];

const settingsFixture = (overrides: Partial<AlertSettings> = {}): AlertSettings => ({
  infrastructure: { email: true, telegram: true },
  version: 0,
  updatedAt: null,
  ...overrides,
});

type Routes = Parameters<typeof stubApi>[0];

function setup(routes: Routes = {}, permissions: Permission[] = PERMISSIONS) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 0 })),
    [`GET ${SETTINGS_PATH}`]: jsonResponse(settingsFixture()),
    ...routes,
  });
}

const emailBox = () =>
  screen.getByRole('checkbox', { name: es.integrations['alerts.channels.email.label'] });
const telegramBox = () =>
  screen.getByRole('checkbox', { name: es.integrations['alerts.channels.telegram.label'] });
const saveButton = () => screen.getByRole('button', { name: es.integrations['alerts.save'] });

async function pageLoaded(): Promise<void> {
  await screen.findByRole('heading', { name: es.integrations['alerts.title'] });
}

describe('infrastructure alert settings', () => {
  it('shows both channels on and the defaults notice at version 0', async () => {
    setup();
    renderApp(PAGE);
    await pageLoaded();

    expect(emailBox()).toBeChecked();
    expect(telegramBox()).toBeChecked();
    expect(screen.getByText(es.integrations['alerts.defaults'])).toBeVisible();
    expect(screen.getByText(es.integrations['alerts.channels.email.description'])).toBeVisible();
    expect(saveButton()).toBeEnabled();
  });

  it('shows the saved values and the last update, without the defaults notice', async () => {
    setup({
      [`GET ${SETTINGS_PATH}`]: jsonResponse(
        settingsFixture({
          infrastructure: { email: false, telegram: true },
          version: 2,
          updatedAt: '2030-01-01T18:30:00.000Z',
        }),
      ),
    });
    renderApp(PAGE);
    await pageLoaded();

    expect(emailBox()).not.toBeChecked();
    expect(telegramBox()).toBeChecked();
    expect(screen.queryByText(es.integrations['alerts.defaults'])).toBeNull();
    expect(screen.getByText(/^Última actualización: /)).toBeVisible();
  });

  it('blocks saving with both channels off and explains why', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    await pageLoaded();

    await user.click(emailBox());
    await user.click(telegramBox());

    const message = es.errors['INTEGRATIONS.ALERT_CHANNEL_REQUIRED'];
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAccessibleDescription(message);
    expect(api.callsTo('PUT', SETTINGS_PATH)).toHaveLength(0);

    await user.click(telegramBox());
    expect(screen.queryByText(message)).toBeNull();
    expect(saveButton()).toBeEnabled();
  });

  it('sends the PUT with the loaded version and shows the saved values', async () => {
    const user = userEvent.setup();
    const saved = settingsFixture({
      infrastructure: { email: true, telegram: false },
      version: 4,
      updatedAt: '2030-01-02T10:00:00.000Z',
    });
    const api = setup({
      [`GET ${SETTINGS_PATH}`]: jsonResponse(settingsFixture({ version: 3 })),
      [`PUT ${SETTINGS_PATH}`]: jsonResponse(saved),
    });
    renderApp(PAGE);
    await pageLoaded();

    await user.click(telegramBox());
    await user.click(saveButton());

    expect(await screen.findByText(es.integrations['alerts.saved'])).toBeVisible();
    const [put] = api.callsTo('PUT', SETTINGS_PATH);
    expect(put?.body).toEqual({
      infrastructure: { email: true, telegram: false },
      expectedVersion: 3,
    });
    expect(screen.getByText(/^Última actualización: /)).toBeVisible();
    expect(telegramBox()).not.toBeChecked();
  });

  it('shows the conflict message and reloads the current values on CONFLICT.VERSION', async () => {
    const user = userEvent.setup();
    let reads = 0;
    const api = setup({
      [`GET ${SETTINGS_PATH}`]: () => {
        reads += 1;
        return jsonResponse(
          reads === 1
            ? settingsFixture({ version: 3 })
            : settingsFixture({
                infrastructure: { email: false, telegram: true },
                version: 4,
                updatedAt: '2030-01-02T10:00:00.000Z',
              }),
        );
      },
      [`PUT ${SETTINGS_PATH}`]: problem(409, 'CONFLICT.VERSION'),
    });
    renderApp(PAGE);
    await pageLoaded();

    await user.click(telegramBox());
    await user.click(saveButton());

    expect(await screen.findByText(es.integrations['alerts.conflict'])).toBeVisible();
    await waitFor(() => {
      expect(emailBox()).not.toBeChecked();
    });
    expect(telegramBox()).toBeChecked();
    expect(api.callsTo('GET', SETTINGS_PATH)).toHaveLength(2);
  });

  it('maps INTEGRATIONS.ALERT_CHANNEL_REQUIRED from the server to the same inline message', async () => {
    const user = userEvent.setup();
    setup({
      [`PUT ${SETTINGS_PATH}`]: problem(422, 'INTEGRATIONS.ALERT_CHANNEL_REQUIRED'),
    });
    renderApp(PAGE);
    await pageLoaded();

    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      es.errors['INTEGRATIONS.ALERT_CHANNEL_REQUIRED'],
    );
    expect(saveButton()).toBeDisabled();
  });

  it('shows a retryable error when the settings cannot be loaded', async () => {
    const user = userEvent.setup();
    // Falla hasta que aparece el aviso: Query reintenta solo los 5xx, así que fallar una única vez no
    // llegaría a mostrar el error.
    let mode: 'fail' | 'ok' = 'fail';
    setup({
      [`GET ${SETTINGS_PATH}`]: () =>
        mode === 'fail' ? problem(500, 'INTERNAL') : jsonResponse(settingsFixture()),
    });
    renderApp(PAGE);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.INTERNAL);
    mode = 'ok';
    await user.click(within(alert).getByRole('button', { name: es.common['actions.retry'] }));
    await pageLoaded();
    expect(emailBox()).toBeChecked();
  });

  it('hides the screen and the navigation link without the permission', async () => {
    const api = setup({}, []);
    renderApp(PAGE);

    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeVisible();
    expect(screen.queryByRole('link', { name: es.common['nav.alerts'] })).toBeNull();
    expect(api.callsTo('GET', SETTINGS_PATH)).toHaveLength(0);
  });

  it('offers the navigation link with the permission', async () => {
    setup();
    renderApp(PAGE);
    await pageLoaded();

    expect(screen.getByRole('link', { name: es.common['nav.alerts'] })).toHaveAttribute(
      'href',
      '/alerts',
    );
  });

  it('has no accessibility violations', async () => {
    setup();
    const { container } = renderApp(PAGE);
    await pageLoaded();

    expect(await axeViolations(container)).toEqual([]);
  });

  it('keeps every alert text in both locales', async () => {
    const catalog = await loadIntegrationsCatalog();
    const keys = Object.keys(catalog['es-MX']);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(catalog['en-US']).toHaveProperty([key]);
    }
    expect(resources['en-US'].common).toHaveProperty(['nav.alerts']);
  });
});
