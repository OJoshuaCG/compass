import type { OidcClient, Permission } from '@iam/contracts';
import { loadOidcClientsCatalog } from '@iam/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const catalog = await loadOidcClientsCatalog();
const t = catalog['es-MX'];
const en = catalog['en-US'];

const PAGE = '/sso/clients';
const CLIENTS_PATH = '/sso/clients';
const MANAGE: Permission[] = ['sso.clients.manage'];
const CLIENT_ROW_ID = '0190d3c4-0000-7000-8000-0000000000a1';
const SECRET = 'S3cr3t-Valor-Unico-0123456789abcdefghijklmnopqrstuvw';
const ROTATED_SECRET = 'N0vo-Secreto-Rotado-9876543210zyxwvutsrqponmlkjihg';

// Prefijo fijo del nombre accesible por fila (antes del nombre de la aplicación).
const rotateLabelPrefix = t['action.rotateLabel'].split('{{')[0] ?? '';
const disableLabelPrefix = t['action.disableLabel'].split('{{')[0] ?? '';

const withValues = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    template,
  );

const clientFixture = (overrides: Partial<OidcClient> = {}): OidcClient => ({
  id: CLIENT_ROW_ID,
  clientId: 'cmp_AbCdEfGhIjKlMnOpQrStUv',
  name: 'Acme CRM',
  redirectUris: ['https://crm.example.com/callback'],
  postLogoutRedirectUris: [],
  backchannelLogoutUri: null,
  allowPrivateNetworkBackchannel: false,
  allowRefreshTokens: false,
  refreshJustification: null,
  isExternal: false,
  maxRank: null,
  status: 'active',
  createdAt: '2030-01-01T10:00:00.000Z',
  ...overrides,
});

type Routes = Parameters<typeof stubApi>[0];

function setup(routes: Routes = {}, permissions: Permission[] = MANAGE) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    [`GET ${CLIENTS_PATH}`]: jsonResponse({ data: [clientFixture()] }),
    ...routes,
  });
}

async function pageLoaded(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: t.title });
}

async function openRegisterDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: t['action.register'] }));
  return screen.findByRole('dialog', { name: t['register.title'] });
}

async function fillMinimalForm(dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  await user.type(field(t['form.name']), 'Acme CRM');
  await user.type(
    within(dialog).getByRole('textbox', {
      name: withValues(t['uri.item'], { label: t['form.redirectUris'], position: '1' }),
    }),
    'https://crm.example.com/callback',
  );
}

describe('oidc clients: list', () => {
  it('shows name, client id in monospace, status with text, type, rank and date', async () => {
    setup({
      [`GET ${CLIENTS_PATH}`]: jsonResponse({
        data: [
          clientFixture({ isExternal: true, maxRank: 2 }),
          clientFixture({
            id: '0190d3c4-0000-7000-8000-0000000000a2',
            clientId: 'cmp_Disabled0000000000000',
            name: 'Legacy app',
            status: 'disabled',
          }),
        ],
      }),
    });
    const { container } = renderApp(PAGE);
    await pageLoaded();

    expect(await screen.findByText('Acme CRM')).toBeVisible();
    expect(screen.getByText('cmp_AbCdEfGhIjKlMnOpQrStUv')).toHaveClass('font-mono');
    expect(screen.getByText(t['status.active'])).toBeVisible();
    expect(screen.getByText(t['status.disabled'])).toBeVisible();
    expect(screen.getByText(t['kind.external'])).toBeVisible();
    expect(screen.getByText(t['kind.internal'])).toBeVisible();
    expect(
      screen.getByText(withValues(t['maxRank.upTo'], { rank: es.common['rank.2'] })),
    ).toBeVisible();
    expect(screen.getByText(t['maxRank.any'])).toBeVisible();
    expect(screen.getAllByText(es.common['nav.group.access']).length).toBeGreaterThanOrEqual(2);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers rotate and disable only on active applications', async () => {
    setup({
      [`GET ${CLIENTS_PATH}`]: jsonResponse({
        data: [
          clientFixture({ status: 'disabled' }),
          clientFixture({ id: '0190d3c4-0000-7000-8000-0000000000a3', name: 'Active app' }),
        ],
      }),
    });
    renderApp(PAGE);
    await pageLoaded();
    await screen.findByText('Active app');

    expect(
      screen.getAllByRole('button', { name: new RegExp(`^${rotateLabelPrefix}`) }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: new RegExp(`^${disableLabelPrefix}`) }),
    ).toHaveLength(1);
  });

  it('renders the same screen in English with the English catalog', async () => {
    setup();
    const { container } = renderApp(PAGE, 'en-US');
    await screen.findByRole('heading', { level: 1, name: en.title });

    expect(await screen.findByText(en['status.active'])).toBeVisible();
    expect(screen.getByRole('button', { name: en['action.register'] })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('explains the empty state and offers to register', async () => {
    setup({ [`GET ${CLIENTS_PATH}`]: jsonResponse({ data: [] }) });
    renderApp(PAGE);
    await pageLoaded();

    expect(await screen.findByText(t['empty.title'])).toBeVisible();
    expect(screen.getAllByRole('button', { name: t['action.register'] })).toHaveLength(2);
  });

  it('shows a loading state and then an error with a retry that reloads the list', async () => {
    const user = userEvent.setup();
    let failing = true;
    const api = setup({
      [`GET ${CLIENTS_PATH}`]: () =>
        failing ? problem(500, 'INTERNAL') : jsonResponse({ data: [clientFixture()] }),
    });
    renderApp(PAGE);
    await pageLoaded();

    const retry = await screen.findByRole('button', { name: es.common['actions.retry'] });
    failing = false;
    await user.click(retry);

    expect(await screen.findByText('Acme CRM')).toBeVisible();
    expect(api.callsTo('GET', CLIENTS_PATH).length).toBeGreaterThanOrEqual(2);
  });

  it('asks to confirm the identity when the list requires a recent reauthentication', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    setup({
      [`GET ${CLIENTS_PATH}`]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(403, 'AUTHZ.REAUTH_REQUIRED')
          : jsonResponse({ data: [clientFixture()] });
      },
      'POST /auth/reauth': noContent(),
    });
    renderApp(PAGE);

    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(reauth).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '246810',
    );
    await user.click(within(reauth).getByRole('button', { name: es.common['reauth.submit'] }));

    expect(await screen.findByText('Acme CRM')).toBeVisible();
  });
});

describe('oidc clients: permission', () => {
  it('answers as a missing route and never calls the API without sso.clients.manage', async () => {
    const api = setup({}, []);
    renderApp(PAGE);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: t.title })).toBeNull();
    });
    expect(api.callsTo('GET', CLIENTS_PATH)).toHaveLength(0);
  });

  it('adds the navigation link only with the permission', async () => {
    setup();
    renderApp(PAGE);
    await pageLoaded();
    expect(screen.getByRole('link', { name: es.common['nav.ssoClients'] })).toHaveAttribute(
      'href',
      '/sso/clients',
    );
  });

  it('does not show the navigation link without the permission', async () => {
    setup({}, ['user.invite']);
    renderApp('/');
    await screen.findByRole('navigation', { name: es.common['nav.label'] });
    expect(screen.queryByRole('link', { name: es.common['nav.ssoClients'] })).toBeNull();
  });

  it('shows the server permission error when registering is denied', async () => {
    const user = userEvent.setup();
    setup({ [`POST ${CLIENTS_PATH}`]: problem(403, 'AUTHZ.PERMISSION') });
    renderApp(PAGE);
    await pageLoaded();

    const dialog = await openRegisterDialog(user);
    await fillMinimalForm(dialog, user);
    await user.click(within(dialog).getByRole('button', { name: t['register.submit'] }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.PERMISSION'],
    );
  });
});

describe('oidc clients: register', () => {
  it('validates at the edge: nothing is sent and the errors sit next to their fields', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    await pageLoaded();

    const dialog = await openRegisterDialog(user);
    expect(await axeViolations(dialog)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: t['register.submit'] }));

    await waitFor(() => {
      expect(field(t['form.name'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(
      within(dialog).getAllByText(es.common['validation.required']).length,
    ).toBeGreaterThanOrEqual(2);
    expect(api.callsTo('POST', CLIENTS_PATH)).toHaveLength(0);
  });

  it('registers, shows the secret once in a monospace panel and discards it on close', async () => {
    const user = userEvent.setup();
    let registered = false;
    const created = clientFixture({ name: 'Acme CRM', isExternal: true, maxRank: 1 });
    const api = setup({
      [`GET ${CLIENTS_PATH}`]: () => jsonResponse({ data: registered ? [created] : [] }),
      [`POST ${CLIENTS_PATH}`]: () => {
        registered = true;
        return jsonResponse({ data: { client: created, clientSecret: SECRET } }, 201, {
          'Cache-Control': 'no-store',
        });
      },
    });
    const { queryClient } = renderApp(PAGE);
    await pageLoaded();

    const dialog = await openRegisterDialog(user);
    await fillMinimalForm(dialog, user);
    await user.selectOptions(field(t['form.maxRank']), '1');
    await user.click(within(dialog).getByRole('checkbox', { name: t['form.isExternal'] }));
    await user.click(within(dialog).getByRole('button', { name: t['register.submit'] }));

    const secretDialog = await screen.findByRole('dialog', { name: t['registered.title'] });
    expect(api.callsTo('POST', CLIENTS_PATH)[0]?.body).toEqual({
      name: 'Acme CRM',
      redirectUris: ['https://crm.example.com/callback'],
      isExternal: true,
      maxRank: 1,
    });
    const secret = within(secretDialog).getByText(SECRET);
    expect(secret).toHaveClass('font-mono', 'text-accent', 'bg-raised');
    expect(within(secretDialog).getByText(t['secret.warning'])).toBeVisible();
    expect(within(secretDialog).getByRole('button', { name: t['secret.copy'] })).toBeEnabled();
    expect(await axeViolations(secretDialog)).toEqual([]);

    // La lista se recarga por detrás mientras el secreto sigue en el diálogo.
    expect(await screen.findAllByText('Acme CRM')).not.toHaveLength(0);
    expectNoSecretsStored(queryClient, [SECRET]);

    await user.click(within(secretDialog).getByRole('button', { name: t['secret.done'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.textContent).not.toContain(SECRET);
    expectNoSecretsStored(queryClient, [SECRET]);

    // Reabrir el registro no trae el secreto de vuelta.
    const reopened = await openRegisterDialog(user);
    expect(reopened.textContent).not.toContain(SECRET);
  });

  it('maps the server field errors of a 422 to their fields and keeps the dialog open', async () => {
    const user = userEvent.setup();
    setup({
      [`POST ${CLIENTS_PATH}`]: problem(422, 'VALIDATION.FAILED', {
        errors: [{ field: 'redirectUris', code: 'invalid' }],
      }),
    });
    renderApp(PAGE);
    await pageLoaded();

    const dialog = await openRegisterDialog(user);
    await fillMinimalForm(dialog, user);
    await user.click(within(dialog).getByRole('button', { name: t['register.submit'] }));

    expect(await within(dialog).findByText(es.errors['VALIDATION.FAILED'])).toBeVisible();
    expect(screen.queryByRole('dialog', { name: t['registered.title'] })).toBeNull();
  });

  it('offers the private-network option only to who holds org.settings and has a backchannel address', async () => {
    const user = userEvent.setup();
    setup({}, [...MANAGE, 'org.settings']);
    renderApp(PAGE);
    await pageLoaded();

    const dialog = await openRegisterDialog(user);
    expect(
      within(dialog).queryByRole('checkbox', { name: t['form.allowPrivateNetworkBackchannel'] }),
    ).toBeNull();
    await user.type(field(t['form.backchannelLogoutUri']), 'https://crm.example.com/logout');
    expect(
      within(dialog).getByRole('checkbox', { name: t['form.allowPrivateNetworkBackchannel'] }),
    ).toBeVisible();
  });

  it('never offers the private-network option without org.settings', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    await pageLoaded();

    const dialog = await openRegisterDialog(user);
    await user.type(field(t['form.backchannelLogoutUri']), 'https://crm.example.com/logout');
    expect(
      within(dialog).queryByRole('checkbox', { name: t['form.allowPrivateNetworkBackchannel'] }),
    ).toBeNull();
  });

  it('adds and removes redirect rows up to the contract maximum', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    await pageLoaded();

    const dialog = await openRegisterDialog(user);
    const group = within(dialog).getByRole('group', {
      name: new RegExp(`^${t['form.redirectUris']}`),
    });
    for (let row = 1; row < 10; row += 1) {
      await user.click(within(group).getByRole('button', { name: t['uri.add'] }));
    }
    expect(within(group).getAllByRole('textbox')).toHaveLength(10);
    expect(within(group).getByRole('button', { name: t['uri.add'] })).toBeDisabled();

    await user.click(
      within(group).getByRole('button', {
        name: withValues(t['uri.remove'], { label: t['form.redirectUris'], position: '10' }),
      }),
    );
    expect(within(group).getAllByRole('textbox')).toHaveLength(9);
  });

  it('asks to confirm the identity and retries the registration once', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = setup({
      [`POST ${CLIENTS_PATH}`]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(403, 'AUTHZ.REAUTH_REQUIRED')
          : jsonResponse({ data: { client: clientFixture(), clientSecret: SECRET } }, 201);
      },
      'POST /auth/reauth': noContent(),
    });
    renderApp(PAGE);
    await pageLoaded();

    const dialog = await openRegisterDialog(user);
    await fillMinimalForm(dialog, user);
    await user.click(within(dialog).getByRole('button', { name: t['register.submit'] }));

    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(reauth).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '246810',
    );
    await user.click(within(reauth).getByRole('button', { name: es.common['reauth.submit'] }));

    expect(await screen.findByText(SECRET)).toBeVisible();
    expect(api.callsTo('POST', CLIENTS_PATH)).toHaveLength(2);
  });
});

describe('oidc clients: rotate secret', () => {
  const ROTATE_PATH = `${CLIENTS_PATH}/${CLIENT_ROW_ID}/rotate-secret`;

  it('confirms, shows the new secret once and leaves no trace of it after closing', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`POST ${ROTATE_PATH}`]: jsonResponse(
        { data: { client: clientFixture(), clientSecret: ROTATED_SECRET } },
        200,
        { 'Cache-Control': 'no-store' },
      ),
    });
    const { queryClient } = renderApp(PAGE);
    await pageLoaded();

    await user.click(
      await screen.findByRole('button', {
        name: withValues(t['action.rotateLabel'], { name: 'Acme CRM' }),
      }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: withValues(t['rotate.title'], { name: 'Acme CRM' }),
    });
    expect(api.callsTo('POST', ROTATE_PATH)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t['rotate.confirm'] }));

    const secretDialog = await screen.findByRole('dialog', { name: t['rotated.title'] });
    expect(within(secretDialog).getByText(ROTATED_SECRET)).toHaveClass('font-mono', 'text-accent');
    expect(api.callsTo('POST', ROTATE_PATH)).toHaveLength(1);
    expectNoSecretsStored(queryClient, [ROTATED_SECRET]);

    await user.click(within(secretDialog).getByRole('button', { name: t['secret.done'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.textContent).not.toContain(ROTATED_SECRET);
    expectNoSecretsStored(queryClient, [ROTATED_SECRET]);
  });

  it('does not rotate when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    await pageLoaded();

    await user.click(
      await screen.findByRole('button', {
        name: withValues(t['action.rotateLabel'], { name: 'Acme CRM' }),
      }),
    );
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: es.common['actions.cancel'] }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('POST', ROTATE_PATH)).toHaveLength(0);
  });

  it('asks to confirm the identity and retries the rotation once', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = setup({
      [`POST ${ROTATE_PATH}`]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(403, 'AUTHZ.REAUTH_REQUIRED')
          : jsonResponse({ data: { client: clientFixture(), clientSecret: ROTATED_SECRET } });
      },
      'POST /auth/reauth': noContent(),
    });
    renderApp(PAGE);
    await pageLoaded();

    await user.click(
      await screen.findByRole('button', {
        name: withValues(t['action.rotateLabel'], { name: 'Acme CRM' }),
      }),
    );
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: t['rotate.confirm'] }));
    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(reauth).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '246810',
    );
    await user.click(within(reauth).getByRole('button', { name: es.common['reauth.submit'] }));

    expect(await screen.findByText(ROTATED_SECRET)).toBeVisible();
    expect(api.callsTo('POST', ROTATE_PATH)).toHaveLength(2);
  });

  it('shows the permission error inside the confirmation and keeps it open', async () => {
    const user = userEvent.setup();
    setup({ [`POST ${ROTATE_PATH}`]: problem(403, 'AUTHZ.PERMISSION') });
    renderApp(PAGE);
    await pageLoaded();

    await user.click(
      await screen.findByRole('button', {
        name: withValues(t['action.rotateLabel'], { name: 'Acme CRM' }),
      }),
    );
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: t['rotate.confirm'] }));

    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.PERMISSION'],
    );
  });
});

describe('oidc clients: disable', () => {
  const DISABLE_PATH = `${CLIENTS_PATH}/${CLIENT_ROW_ID}/disable`;

  it('confirms with a destructive dialog, disables and reloads the list', async () => {
    const user = userEvent.setup();
    let disabled = false;
    const api = setup({
      [`GET ${CLIENTS_PATH}`]: () =>
        jsonResponse({ data: [clientFixture({ status: disabled ? 'disabled' : 'active' })] }),
      [`POST ${DISABLE_PATH}`]: () => {
        disabled = true;
        return jsonResponse({ data: clientFixture({ status: 'disabled' }) });
      },
    });
    renderApp(PAGE);
    await pageLoaded();

    await user.click(
      await screen.findByRole('button', {
        name: withValues(t['action.disableLabel'], { name: 'Acme CRM' }),
      }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: withValues(t['disable.title'], { name: 'Acme CRM' }),
    });
    expect(await axeViolations(confirm)).toEqual([]);
    await user.click(within(confirm).getByRole('button', { name: t['disable.confirm'] }));

    expect(
      await screen.findByText(withValues(t['disable.toast'], { name: 'Acme CRM' })),
    ).toBeVisible();
    expect(await screen.findByText(t['status.disabled'])).toBeVisible();
    expect(api.callsTo('POST', DISABLE_PATH)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: new RegExp(`^${disableLabelPrefix}`) })).toBeNull();
  });

  it('asks to confirm the identity and retries the disable once', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = setup({
      [`POST ${DISABLE_PATH}`]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(403, 'AUTHZ.REAUTH_REQUIRED')
          : jsonResponse({ data: clientFixture({ status: 'disabled' }) });
      },
      'POST /auth/reauth': noContent(),
    });
    renderApp(PAGE);
    await pageLoaded();

    await user.click(
      await screen.findByRole('button', {
        name: withValues(t['action.disableLabel'], { name: 'Acme CRM' }),
      }),
    );
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: t['disable.confirm'] }));
    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(reauth).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '246810',
    );
    await user.click(within(reauth).getByRole('button', { name: es.common['reauth.submit'] }));

    expect(
      await screen.findByText(withValues(t['disable.toast'], { name: 'Acme CRM' })),
    ).toBeVisible();
    expect(api.callsTo('POST', DISABLE_PATH)).toHaveLength(2);
  });
});

describe('oidc clients: secrets never reach the query cache', () => {
  it('keeps only the list in the query cache after registering and rotating', async () => {
    const user = userEvent.setup();
    setup({
      [`POST ${CLIENTS_PATH}`]: jsonResponse(
        { data: { client: clientFixture(), clientSecret: SECRET } },
        201,
      ),
      [`POST ${CLIENTS_PATH}/${CLIENT_ROW_ID}/rotate-secret`]: jsonResponse({
        data: { client: clientFixture(), clientSecret: ROTATED_SECRET },
      }),
    });
    const { queryClient } = renderApp(PAGE);
    await pageLoaded();

    const dialog = await openRegisterDialog(user);
    await fillMinimalForm(dialog, user);
    await user.click(within(dialog).getByRole('button', { name: t['register.submit'] }));
    const secretDialog = await screen.findByRole('dialog', { name: t['registered.title'] });
    await user.click(within(secretDialog).getByRole('button', { name: t['secret.done'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    await user.click(
      await screen.findByRole('button', {
        name: withValues(t['action.rotateLabel'], { name: 'Acme CRM' }),
      }),
    );
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: t['rotate.confirm'] }));
    await screen.findByText(ROTATED_SECRET);

    // Ni consultas ni mutaciones: solo la lista y la sesión.
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => String(query.queryKey[0]));
    expect(keys.every((key) => key === 'oidc-clients' || key === 'session')).toBe(true);
    expectNoSecretsStored(queryClient, [SECRET, ROTATED_SECRET]);
  });
});
