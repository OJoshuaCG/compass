import type { Passkey } from '@iam/contracts';
import { loadSecurityCatalog } from '@iam/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const lib = vi.hoisted(() => ({
  loaded: false,
  supported: true,
  startRegistration: vi.fn(),
}));

vi.mock('@simplewebauthn/browser', () => {
  lib.loaded = true;
  return {
    startRegistration: lib.startRegistration,
    browserSupportsWebAuthn: () => lib.supported,
  };
});

const LAPTOP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OPTIONS = { challenge: 'creation-challenge', rp: { name: 'IAM' }, user: { id: 'u' } };
const ATTESTATION = {
  id: 'cred-9',
  type: 'public-key',
  response: { attestationObject: 'ATTESTATION-SECRET' },
};

const passkey = (overrides: Partial<Passkey>): Passkey => ({
  id: LAPTOP_ID,
  name: 'Laptop oficina',
  createdAt: '2030-01-01T10:00:00.000Z',
  lastUsedAt: '2030-01-02T10:00:00.000Z',
  ...overrides,
});
const LAPTOP = passkey({});
const KEY = passkey({ id: KEY_ID, name: 'Llave USB', lastUsedAt: null });

const listOf = (...items: Passkey[]) =>
  jsonResponse({ data: items, page: { nextCursor: null, limit: 25 } });
const mine = (api: ReturnType<typeof stubApi>) => api.callsTo('GET', '/me/passkeys');
const removeLabel = (name: string) => es.security['action.removeLabel'].replace('{{name}}', name);
const addButton = () => screen.queryByRole('button', { name: es.security['action.add'] });
const rowsLoaded = () => screen.findByText('Laptop oficina');

function setup(extra: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture()),
    'GET /me/passkeys': listOf(LAPTOP, KEY),
    ...extra,
  });
}

beforeEach(() => {
  lib.supported = true;
  lib.startRegistration.mockReset();
});

describe('security screen: passkeys', () => {
  it('lists the passkeys with name, created and last used, without accessibility violations', async () => {
    setup();
    const { container } = renderApp('/security');
    await rowsLoaded();
    const table = screen.getByRole('table', { name: es.security.caption });
    expect(screen.getByRole('heading', { level: 1, name: es.security.title })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // encabezado + 2
    expect(within(rows[1] as HTMLElement).getByText('Laptop oficina')).toBeInTheDocument();
    // Una passkey sin uso muestra un texto, nunca una celda vacía ni "null".
    expect(within(rows[2] as HTMLElement).getByText(es.security['lastUsed.never'])).toBeVisible();
    expect(screen.getByRole('button', { name: removeLabel('Llave USB') })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('is the first tab of Settings, before My sessions', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await user.click(await screen.findByRole('link', { name: es.common['nav.settings'] }));
    await rowsLoaded();
    expect(router.state.location.pathname).toBe('/security');
    const tabs = screen.getByRole('navigation', {
      name: es.common['nav.sectionsOf'].replace('{{section}}', es.common['nav.settings']),
    });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([es.common['nav.security'], es.common['nav.sessions']]);
    expect(within(tabs).getByRole('link', { name: es.common['nav.security'] })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // La entrada de la sección sigue marcada en el menú principal.
    expect(screen.getByRole('link', { name: es.common['nav.settings'] })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('explains what passkeys are in the empty state', async () => {
    setup({ 'GET /me/passkeys': listOf() });
    const { container } = renderApp('/security');
    expect(await screen.findByText(es.security['empty.title'])).toBeInTheDocument();
    expect(screen.getByText(es.security['empty.description'])).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('registers a passkey: name, options, browser prompt, verify, toast and refetch', async () => {
    const user = userEvent.setup();
    let added = false;
    const api = setup({
      'GET /me/passkeys': () => listOf(LAPTOP, ...(added ? [KEY] : [])),
      'POST /me/passkeys/registration/options': jsonResponse(OPTIONS),
      'POST /me/passkeys/registration/verify': () => {
        added = true;
        return jsonResponse(KEY, 201);
      },
    });
    lib.startRegistration.mockResolvedValue(ATTESTATION);
    const { queryClient } = renderApp('/security');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.security['action.add'] }));
    const dialog = await screen.findByRole('dialog', { name: es.security['add.title'] });
    expect(await axeViolations(dialog)).toEqual([]);
    const before = mine(api).length;
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${es.security['add.name']}`)),
      'Llave USB',
    );
    await user.click(within(dialog).getByRole('button', { name: es.security['add.submit'] }));

    expect(
      await screen.findByText(es.security['add.toast'].replace('{{name}}', 'Llave USB')),
    ).toBeInTheDocument();
    expect(lib.startRegistration).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    const verify = api.callsTo('POST', '/me/passkeys/registration/verify')[0];
    expect(verify?.body).toEqual({ name: 'Llave USB', response: ATTESTATION });
    expect(verify?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    await waitFor(() => {
      expect(mine(api).length).toBeGreaterThan(before);
      expect(screen.getByRole('button', { name: removeLabel('Llave USB') })).toBeVisible();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Ni el reto ni la atestación pasan por la caché de Query ni por el almacenamiento.
    expectNoSecretsStored(queryClient, ['ATTESTATION-SECRET', 'creation-challenge']);
  });

  it('validates the name before starting the ceremony', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp('/security');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.security['action.add'] }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.security['add.submit'] }));
    expect(await within(dialog).findByText(es.common['validation.required'])).toBeVisible();
    expect(api.callsTo('POST', '/me/passkeys/registration/options')).toHaveLength(0);
  });

  it('keeps the dialog open with a neutral message when the person cancels the prompt', async () => {
    const user = userEvent.setup();
    const api = setup({ 'POST /me/passkeys/registration/options': jsonResponse(OPTIONS) });
    lib.startRegistration.mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }),
    );
    renderApp('/security');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.security['action.add'] }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(new RegExp(`^${es.security['add.name']}`)), 'X');
    await user.click(within(dialog).getByRole('button', { name: es.security['add.submit'] }));
    expect(await within(dialog).findByText(es.security['add.cancelled'])).toBeVisible();
    expect(api.callsTo('POST', '/me/passkeys/registration/verify')).toHaveLength(0);
    expect(within(dialog).queryByText(es.errors.generic)).toBeNull();
  });

  it('explains the limit when the server refuses new options with 422', async () => {
    const user = userEvent.setup();
    const api = setup({
      'POST /me/passkeys/registration/options': problem(422, 'VALIDATION.FAILED'),
    });
    renderApp('/security');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.security['action.add'] }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(new RegExp(`^${es.security['add.name']}`)), 'X');
    await user.click(within(dialog).getByRole('button', { name: es.security['add.submit'] }));
    expect(await within(dialog).findByText(es.security['add.limit'])).toBeVisible();
    expect(lib.startRegistration).not.toHaveBeenCalled();
    expect(api.callsTo('POST', '/me/passkeys/registration/verify')).toHaveLength(0);
  });

  it('shows the translated server error when the registration cannot be verified', async () => {
    const user = userEvent.setup();
    setup({
      'POST /me/passkeys/registration/options': jsonResponse(OPTIONS),
      'POST /me/passkeys/registration/verify': problem(422, 'VALIDATION.FAILED'),
    });
    lib.startRegistration.mockResolvedValue(ATTESTATION);
    renderApp('/security');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.security['action.add'] }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(new RegExp(`^${es.security['add.name']}`)), 'X');
    await user.click(within(dialog).getByRole('button', { name: es.security['add.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['VALIDATION.FAILED'],
    );
  });

  it('reuses the reauthentication flow when registration options need it', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = setup({
      'POST /me/passkeys/registration/options': () => {
        attempts += 1;
        return attempts === 1 ? problem(403, 'AUTHZ.REAUTH_REQUIRED') : jsonResponse(OPTIONS);
      },
      'POST /auth/reauth': noContent(),
      'POST /me/passkeys/registration/verify': jsonResponse(KEY, 201),
    });
    lib.startRegistration.mockResolvedValue(ATTESTATION);
    renderApp('/security');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.security['action.add'] }));
    const dialog = await screen.findByRole('dialog', { name: es.security['add.title'] });
    await user.type(within(dialog).getByLabelText(new RegExp(`^${es.security['add.name']}`)), 'X');
    await user.click(within(dialog).getByRole('button', { name: es.security['add.submit'] }));
    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(reauth).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '123456',
    );
    await user.click(within(reauth).getByRole('button', { name: es.common['reauth.submit'] }));
    await waitFor(() => {
      expect(api.callsTo('POST', '/me/passkeys/registration/verify')).toHaveLength(1);
    });
    expect(api.callsTo('POST', '/me/passkeys/registration/options')).toHaveLength(2);
  });

  it('shows an explanation instead of the add button when WebAuthn is unsupported', async () => {
    lib.supported = false;
    setup();
    const { container } = renderApp('/security');
    await rowsLoaded();
    expect(await screen.findByText(es.security['unsupported.message'])).toBeVisible();
    expect(addButton()).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('asks for confirmation, revokes only that passkey and refetches the list', async () => {
    const user = userEvent.setup();
    let revoked = false;
    const api = setup({
      'GET /me/passkeys': () => listOf(LAPTOP, ...(revoked ? [] : [KEY])),
      [`POST /me/passkeys/${KEY_ID}/revoke`]: () => {
        revoked = true;
        return noContent();
      },
    });
    renderApp('/security');
    await user.click(await screen.findByRole('button', { name: removeLabel('Llave USB') }));
    const dialog = await screen.findByRole('dialog', { name: es.security['remove.title'] });
    expect(await axeViolations(dialog)).toEqual([]);
    expect(api.callsTo('POST', `/me/passkeys/${KEY_ID}/revoke`)).toHaveLength(0);
    const before = mine(api).length;

    await user.click(within(dialog).getByRole('button', { name: es.security['remove.confirm'] }));

    expect(await screen.findByText(es.security['remove.toast'])).toBeInTheDocument();
    expect(
      api.callsTo('POST', `/me/passkeys/${KEY_ID}/revoke`)[0]?.headers.get('X-Requested-With'),
    ).toBe('XMLHttpRequest');
    await waitFor(() => {
      expect(mine(api).length).toBeGreaterThan(before);
      expect(screen.queryByRole('button', { name: removeLabel('Llave USB') })).toBeNull();
    });
  });

  it('cancelling the confirmation sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /me/passkeys/${KEY_ID}/revoke`]: noContent() });
    renderApp('/security');
    await user.click(await screen.findByRole('button', { name: removeLabel('Llave USB') }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('POST', `/me/passkeys/${KEY_ID}/revoke`)).toHaveLength(0);
  });

  it('treats a 404 (already gone) as removed and refreshes the list', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /me/passkeys/${KEY_ID}/revoke`]: problem(404, 'NOT_FOUND') });
    renderApp('/security');
    await user.click(await screen.findByRole('button', { name: removeLabel('Llave USB') }));
    const dialog = await screen.findByRole('dialog');
    const before = mine(api).length;
    await user.click(within(dialog).getByRole('button', { name: es.security['remove.confirm'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mine(api).length).toBeGreaterThan(before);
    });
  });

  it('shows a translated list error with Retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    setup({ 'GET /me/passkeys': () => (fail ? problem(500, 'INTERNAL') : listOf(LAPTOP)) });
    renderApp('/security');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.INTERNAL);
    fail = false;
    await user.click(within(alert).getByRole('button', { name: es.common['actions.retry'] }));
    await rowsLoaded();
  });

  it('renders in English too', async () => {
    const en = (await loadSecurityCatalog())['en-US'];
    setup();
    renderApp('/security', 'en-US');
    expect(await screen.findByRole('table', { name: en.caption })).toBeInTheDocument();
    await rowsLoaded();
    expect(screen.getByRole('button', { name: en['action.add'] })).toBeVisible();
  });
});
