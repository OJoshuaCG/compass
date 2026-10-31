import type { Account, Permission, Platform } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const PLATFORM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PLATFORM_ID = '11111111-1111-4111-8111-222222222222';
const MANAGED_ID = '22222222-2222-4222-8222-222222222221';
const EDITABLE_ID = '22222222-2222-4222-8222-222222222222';
const VIEWABLE_ID = '22222222-2222-4222-8222-222222222223';
const NEW_ID = '22222222-2222-4222-8222-222222222224';
const INVENTORY_ID = '22222222-2222-4222-8222-222222222225';

const PLATFORMS: Platform[] = [
  {
    id: PLATFORM_ID,
    name: 'GitHub',
    slug: 'github',
    loginUrl: null,
    supportsTotp: true,
    isGlobal: true,
  },
  {
    id: OTHER_PLATFORM_ID,
    name: 'Bancos MX',
    slug: 'bancos-mx',
    loginUrl: null,
    supportsTotp: false,
    isGlobal: false,
  },
];

const accountFixture = (overrides: Partial<Account>): Account => ({
  id: MANAGED_ID,
  platformId: PLATFORM_ID,
  displayName: 'Nómina',
  handle: 'rh@example.com',
  ownerGroupId: null,
  tags: ['rh'],
  status: 'active',
  myLevel: 'MANAGE',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const MANAGED = accountFixture({});
const EDITABLE = accountFixture({
  id: EDITABLE_ID,
  displayName: 'Marketing',
  platformId: OTHER_PLATFORM_ID,
  handle: null,
  tags: [],
  myLevel: 'EDIT',
});
const VIEWABLE = accountFixture({
  id: VIEWABLE_ID,
  displayName: 'Soporte',
  handle: null,
  tags: [],
  myLevel: 'VIEW',
});
const INVENTORY_ACCOUNT = accountFixture({
  id: INVENTORY_ID,
  displayName: 'Tesorería',
  myLevel: null,
});

const ALL_ACCOUNT_PERMISSIONS: Permission[] = [
  'account.create',
  'account.update',
  'account.archive',
];

const page = (data: Account[]) => jsonResponse({ data, page: { nextCursor: null, limit: 25 } });
const withName = (template: string, name: string) => template.replace('{{name}}', name);
const editLabel = (name: string) => withName(es.accounts['action.editLabel'], name);
const archiveLabel = (name: string) => withName(es.accounts['action.archiveLabel'], name);
const accountsCalls = (api: ReturnType<typeof stubApi>) => api.callsTo('GET', '/accounts');

function setup(
  extra: Record<string, Parameters<typeof stubApi>[0][string]> = {},
  permissions: Permission[] = ALL_ACCOUNT_PERMISSIONS,
) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    'GET /accounts': page([MANAGED, EDITABLE, VIEWABLE]),
    'GET /platforms': jsonResponse({ data: PLATFORMS }),
    ...extra,
  });
}

/** La tabla se pinta ya en su estado de carga: se espera a que lleguen las filas. */
const rowsLoaded = () => screen.findByRole('cell', { name: 'Nómina' });

describe('accounts navigation', () => {
  it('shows the nav link to every active member and reaches the screen', async () => {
    // `GET /accounts` solo exige ser miembro activo: no hay permiso del catálogo que lo condicione.
    setup({}, []);
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await user.click(await screen.findByRole('link', { name: es.common['nav.accounts'] }));
    await rowsLoaded();
    expect(router.state.location.pathname).toBe('/accounts');
  });
});

describe('accounts table', () => {
  it('lists name, platform, own level as text and status, without violations', async () => {
    setup();
    const { container } = renderApp('/accounts');
    await rowsLoaded();
    const table = screen.getByRole('table', { name: es.accounts.caption });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([
        es.accounts['col.name'],
        es.accounts['col.platform'],
        es.accounts['col.level'],
        es.accounts['col.status'],
      ]),
    );
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    const managed = within(rows[1] as HTMLElement);
    expect(await managed.findByRole('cell', { name: 'GitHub' })).toBeInTheDocument();
    expect(managed.getByText(es.accounts['level.MANAGE'])).toBeInTheDocument();
    expect(managed.getByText(es.accounts['status.active'])).toBeInTheDocument();
    const editable = within(rows[2] as HTMLElement);
    expect(editable.getByRole('cell', { name: 'Bancos MX' })).toBeInTheDocument();
    expect(editable.getByText(es.accounts['level.EDIT'])).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows an empty state and a translated error with Retry', async () => {
    const user = userEvent.setup();
    let mode: 'empty' | 'fail' = 'fail';
    setup({ 'GET /accounts': () => (mode === 'fail' ? problem(500, 'INTERNAL') : page([])) });
    renderApp('/accounts');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.INTERNAL);
    mode = 'empty';
    await user.click(within(alert).getByRole('button', { name: es.common['actions.retry'] }));
    expect(await screen.findByText(es.accounts['empty.title'])).toBeInTheDocument();
  });

  it('offers Edit and Archive according to permission AND the level of each row', async () => {
    setup();
    renderApp('/accounts');
    await rowsLoaded();
    // MANAGE: las dos acciones. EDIT: solo editar. VIEW: ninguna.
    expect(screen.getByRole('button', { name: editLabel('Nómina') })).toBeVisible();
    expect(screen.getByRole('button', { name: archiveLabel('Nómina') })).toBeVisible();
    expect(screen.getByRole('button', { name: editLabel('Marketing') })).toBeVisible();
    expect(screen.queryByRole('button', { name: archiveLabel('Marketing') })).toBeNull();
    expect(screen.queryByRole('button', { name: editLabel('Soporte') })).toBeNull();
    expect(screen.queryByRole('button', { name: archiveLabel('Soporte') })).toBeNull();
  });

  it('hides every action and the create button without account permissions', async () => {
    setup({}, []);
    renderApp('/accounts');
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: es.accounts['create.open'] })).toBeNull();
    expect(screen.queryByRole('button', { name: editLabel('Nómina') })).toBeNull();
    expect(screen.queryByRole('button', { name: archiveLabel('Nómina') })).toBeNull();
  });
});

describe('inventory', () => {
  it('hides the inventory tab without vault.inventory.read and never requests it', async () => {
    const api = setup();
    renderApp('/accounts');
    await rowsLoaded();
    expect(screen.queryByRole('tab', { name: es.accounts['tabs.inventory'] })).toBeNull();
    expect(api.callsTo('GET', '/accounts/inventory')).toHaveLength(0);
  });

  it('shows the inventory with metadata only and no actions', async () => {
    const user = userEvent.setup();
    const api = setup({ 'GET /accounts/inventory': page([INVENTORY_ACCOUNT]) }, [
      ...ALL_ACCOUNT_PERMISSIONS,
      'vault.inventory.read',
    ]);
    const { container } = renderApp('/accounts');
    await rowsLoaded();
    await user.click(screen.getByRole('tab', { name: es.accounts['tabs.inventory'] }));
    await screen.findByRole('cell', { name: 'Tesorería' });
    const table = screen.getByRole('table', { name: es.accounts['inventory.caption'] });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).not.toContain(es.accounts['col.level']);
    expect(screen.queryByRole('button', { name: editLabel('Tesorería') })).toBeNull();
    expect(screen.queryByRole('button', { name: archiveLabel('Tesorería') })).toBeNull();
    expect(api.callsTo('GET', '/accounts/inventory')).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows a permission-denied error from the server in the inventory', async () => {
    const user = userEvent.setup();
    setup({ 'GET /accounts/inventory': problem(403, 'AUTHZ.PERMISSION') }, [
      'vault.inventory.read',
    ]);
    renderApp('/accounts');
    await rowsLoaded();
    await user.click(screen.getByRole('tab', { name: es.accounts['tabs.inventory'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.PERMISSION']);
  });
});

describe('create account', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.accounts['create.open'] }));
    const dialog = await screen.findByRole('dialog', { name: es.accounts['create.title'] });
    // El selector se llena cuando llega el catálogo de plataformas.
    await within(dialog).findByRole('option', { name: 'GitHub' });
    return dialog;
  }

  it('sends the chosen data with an idempotency key, then refreshes the list', async () => {
    const user = userEvent.setup();
    let created = false;
    const api = setup({
      'GET /accounts': () => page(created ? [MANAGED, EDITABLE, VIEWABLE] : [MANAGED]),
      'POST /accounts': () => {
        created = true;
        return jsonResponse(accountFixture({ id: NEW_ID, displayName: 'Contabilidad' }), 201);
      },
    });
    renderApp('/accounts');
    const dialog = await openCreate(user);
    expect(await axeViolations(dialog)).toEqual([]);

    await user.selectOptions(field(es.accounts['create.platform']), PLATFORM_ID);
    await user.type(field(es.accounts['form.name']), 'Contabilidad');
    await user.type(field(es.accounts['form.handle']), 'conta@example.com');
    await user.type(field(es.accounts['form.tags']), 'finanzas, mensual');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['create.submit'] }));

    expect(
      await screen.findByText(withName(es.accounts['create.toast'], 'Contabilidad')),
    ).toBeInTheDocument();
    const call = api.callsTo('POST', '/accounts')[0];
    expect(call?.body).toEqual({
      platformId: PLATFORM_ID,
      displayName: 'Contabilidad',
      handle: 'conta@example.com',
      tags: ['finanzas', 'mensual'],
    });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('cell', { name: 'Marketing' })).toBeInTheDocument();
    });
  });

  it('requires a platform and a name, and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp('/accounts');
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByRole('button', { name: es.accounts['create.submit'] }));
    const alerts = await within(dialog).findAllByRole('alert');
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      es.common['validation.required'],
      es.common['validation.required'],
    ]);
    expect(api.callsTo('POST', '/accounts')).toHaveLength(0);
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('maps a 422 to the platform field and keeps the dialog open', async () => {
    const user = userEvent.setup();
    setup({ 'POST /accounts': problem(422, 'ACCOUNT.PLATFORM_INVALID') });
    renderApp('/accounts');
    const dialog = await openCreate(user);
    await user.selectOptions(field(es.accounts['create.platform']), PLATFORM_ID);
    await user.type(field(es.accounts['form.name']), 'Contabilidad');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['create.submit'] }));
    await waitFor(() => {
      expect(field(es.accounts['create.platform'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(dialog).getByText(es.errors['ACCOUNT.PLATFORM_INVALID'])).toBeVisible();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('maps field errors of a 422 validation response to their fields', async () => {
    const user = userEvent.setup();
    setup({
      'POST /accounts': problem(422, 'VALIDATION.FAILED', {
        errors: [{ field: 'displayName', code: 'too_big' }],
      }),
    });
    renderApp('/accounts');
    const dialog = await openCreate(user);
    await user.selectOptions(field(es.accounts['create.platform']), PLATFORM_ID);
    await user.type(field(es.accounts['form.name']), 'Contabilidad');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['create.submit'] }));
    await waitFor(() => {
      expect(field(es.accounts['form.name'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(dialog).getByText(es.errors['VALIDATION.FAILED'])).toBeVisible();
  });

  it('shows a 403 in the dialog without retrying', async () => {
    const user = userEvent.setup();
    const api = setup({ 'POST /accounts': problem(403, 'AUTHZ.PERMISSION') });
    renderApp('/accounts');
    const dialog = await openCreate(user);
    await user.selectOptions(field(es.accounts['create.platform']), PLATFORM_ID);
    await user.type(field(es.accounts['form.name']), 'Contabilidad');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['create.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.PERMISSION'],
    );
    expect(api.callsTo('POST', '/accounts')).toHaveLength(1);
  });

  it('disables the submit button during a 429 and shows the wait time', async () => {
    const user = userEvent.setup();
    setup({
      'POST /accounts': problem(429, 'RATE_LIMITED', { headers: { 'Retry-After': '7' } }),
    });
    renderApp('/accounts');
    const dialog = await openCreate(user);
    await user.selectOptions(field(es.accounts['create.platform']), PLATFORM_ID);
    await user.type(field(es.accounts['form.name']), 'Contabilidad');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['create.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors.RATE_LIMITED);
    expect(
      within(dialog).getByRole('button', { name: es.accounts['create.submit'] }),
    ).toBeDisabled();
  });

  it('shows a generic error with the request id on a 5xx', async () => {
    const user = userEvent.setup();
    setup({ 'POST /accounts': problem(500, 'INTERNAL') });
    renderApp('/accounts');
    const dialog = await openCreate(user);
    await user.selectOptions(field(es.accounts['create.platform']), PLATFORM_ID);
    await user.type(field(es.accounts['form.name']), 'Contabilidad');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['create.submit'] }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.INTERNAL);
    expect(alert).toHaveTextContent('req-test-1');
  });
});

describe('edit account', () => {
  const editTitle = (name: string) => withName(es.accounts['edit.title'], name);

  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: editLabel('Nómina') }));
    return screen.findByRole('dialog', { name: editTitle('Nómina') });
  }

  it('opens with the current values and sends only the fields that changed', async () => {
    const user = userEvent.setup();
    let updated = false;
    const api = setup({
      'GET /accounts': () =>
        page([updated ? { ...MANAGED, displayName: 'Nómina 2' } : MANAGED, EDITABLE]),
      [`PATCH /accounts/${MANAGED_ID}`]: () => {
        updated = true;
        return jsonResponse({ ...MANAGED, displayName: 'Nómina 2' });
      },
    });
    renderApp('/accounts');
    const dialog = await openEdit(user);
    expect(field(es.accounts['form.name'])).toHaveValue('Nómina');
    expect(field(es.accounts['form.handle'])).toHaveValue('rh@example.com');
    expect(field(es.accounts['form.tags'])).toHaveValue('rh');
    expect(await axeViolations(dialog)).toEqual([]);

    await user.clear(field(es.accounts['form.name']));
    await user.type(field(es.accounts['form.name']), 'Nómina 2');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['edit.submit'] }));

    expect(
      await screen.findByText(withName(es.accounts['edit.toast'], 'Nómina 2')),
    ).toBeInTheDocument();
    const call = api.callsTo('PATCH', `/accounts/${MANAGED_ID}`)[0];
    expect(call?.body).toEqual({ displayName: 'Nómina 2' });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('cell', { name: 'Nómina 2' })).toBeInTheDocument();
    });
  });

  it('clears the handle with null', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`PATCH /accounts/${MANAGED_ID}`]: jsonResponse({ ...MANAGED, handle: null }),
    });
    renderApp('/accounts');
    const dialog = await openEdit(user);
    await user.clear(field(es.accounts['form.handle']));
    await user.click(within(dialog).getByRole('button', { name: es.accounts['edit.submit'] }));
    await waitFor(() => {
      expect(api.callsTo('PATCH', `/accounts/${MANAGED_ID}`)).toHaveLength(1);
    });
    expect(api.callsTo('PATCH', `/accounts/${MANAGED_ID}`)[0]?.body).toEqual({ handle: null });
  });

  it('closes without a request when nothing changed', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH /accounts/${MANAGED_ID}`]: jsonResponse(MANAGED) });
    renderApp('/accounts');
    const dialog = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: es.accounts['edit.submit'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('PATCH', `/accounts/${MANAGED_ID}`)).toHaveLength(0);
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH /accounts/${MANAGED_ID}`]: jsonResponse(MANAGED) });
    renderApp('/accounts');
    const dialog = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('PATCH', `/accounts/${MANAGED_ID}`)).toHaveLength(0);
  });

  it('requires a name and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH /accounts/${MANAGED_ID}`]: jsonResponse(MANAGED) });
    renderApp('/accounts');
    const dialog = await openEdit(user);
    await user.clear(field(es.accounts['form.name']));
    await user.click(within(dialog).getByRole('button', { name: es.accounts['edit.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.common['validation.required'],
    );
    expect(api.callsTo('PATCH', `/accounts/${MANAGED_ID}`)).toHaveLength(0);
  });

  it('shows AUTHZ.SHARE (403) in the dialog', async () => {
    const user = userEvent.setup();
    setup({ [`PATCH /accounts/${MANAGED_ID}`]: problem(403, 'AUTHZ.SHARE') });
    renderApp('/accounts');
    const dialog = await openEdit(user);
    await user.type(field(es.accounts['form.tags']), ', extra');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['edit.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers to reload on a 409 conflict', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH /accounts/${MANAGED_ID}`]: problem(409, 'ACCOUNT.ARCHIVED') });
    renderApp('/accounts');
    const dialog = await openEdit(user);
    await user.type(field(es.accounts['form.tags']), ', extra');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['edit.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['ACCOUNT.ARCHIVED'],
    );
    const before = accountsCalls(api).length;
    await user.click(within(dialog).getByRole('button', { name: es.accounts['edit.reload'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(accountsCalls(api).length).toBeGreaterThan(before);
    });
  });

  it('maps a 422 to the field', async () => {
    const user = userEvent.setup();
    setup({
      [`PATCH /accounts/${MANAGED_ID}`]: problem(422, 'VALIDATION.FAILED', {
        errors: [{ field: 'handle', code: 'too_big' }],
      }),
    });
    renderApp('/accounts');
    const dialog = await openEdit(user);
    await user.type(field(es.accounts['form.handle']), 'x');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['edit.submit'] }));
    await waitFor(() => {
      expect(field(es.accounts['form.handle'])).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('disables the submit button during a 429', async () => {
    const user = userEvent.setup();
    setup({
      [`PATCH /accounts/${MANAGED_ID}`]: problem(429, 'RATE_LIMITED', {
        headers: { 'Retry-After': '7' },
      }),
    });
    renderApp('/accounts');
    const dialog = await openEdit(user);
    await user.type(field(es.accounts['form.tags']), ', extra');
    await user.click(within(dialog).getByRole('button', { name: es.accounts['edit.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors.RATE_LIMITED);
    expect(within(dialog).getByRole('button', { name: es.accounts['edit.submit'] })).toBeDisabled();
  });
});

describe('archive account', () => {
  async function openArchive(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: archiveLabel('Nómina') }));
    return screen.findByRole('dialog', {
      name: withName(es.accounts['archive.title'], 'Nómina'),
    });
  }

  it('asks for confirmation, archives only that account and refetches the list', async () => {
    const user = userEvent.setup();
    let archived = false;
    const api = setup({
      'GET /accounts': () => page(archived ? [EDITABLE] : [MANAGED, EDITABLE]),
      [`POST /accounts/${MANAGED_ID}/archive`]: () => {
        archived = true;
        return noContent();
      },
    });
    renderApp('/accounts');
    const dialog = await openArchive(user);
    expect(await axeViolations(dialog)).toEqual([]);
    expect(api.callsTo('POST', `/accounts/${MANAGED_ID}/archive`)).toHaveLength(0);
    const before = accountsCalls(api).length;

    await user.click(within(dialog).getByRole('button', { name: es.accounts['archive.confirm'] }));

    expect(
      await screen.findByText(withName(es.accounts['archive.toast'], 'Nómina')),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(accountsCalls(api).length).toBeGreaterThan(before);
      expect(screen.queryByRole('cell', { name: 'Nómina' })).toBeNull();
    });
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /accounts/${MANAGED_ID}/archive`]: noContent() });
    renderApp('/accounts');
    const dialog = await openArchive(user);
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('POST', `/accounts/${MANAGED_ID}/archive`)).toHaveLength(0);
  });

  it('shows AUTHZ.SHARE (403) inside the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    setup({ [`POST /accounts/${MANAGED_ID}/archive`]: problem(403, 'AUTHZ.SHARE') });
    renderApp('/accounts');
    const dialog = await openArchive(user);
    await user.click(within(dialog).getByRole('button', { name: es.accounts['archive.confirm'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });

  it('shows a 409 inside the dialog', async () => {
    const user = userEvent.setup();
    setup({ [`POST /accounts/${MANAGED_ID}/archive`]: problem(409, 'ACCOUNT.ARCHIVED') });
    renderApp('/accounts');
    const dialog = await openArchive(user);
    await user.click(within(dialog).getByRole('button', { name: es.accounts['archive.confirm'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['ACCOUNT.ARCHIVED'],
    );
  });

  it('treats a 404 (already gone) as archived and refreshes', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /accounts/${MANAGED_ID}/archive`]: problem(404, 'NOT_FOUND') });
    renderApp('/accounts');
    await rowsLoaded();
    const before = accountsCalls(api).length;
    const dialog = await openArchive(user);
    await user.click(within(dialog).getByRole('button', { name: es.accounts['archive.confirm'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(accountsCalls(api).length).toBeGreaterThan(before);
    });
  });

  it('shows the wait time on a 429', async () => {
    const user = userEvent.setup();
    setup({
      [`POST /accounts/${MANAGED_ID}/archive`]: problem(429, 'RATE_LIMITED', {
        headers: { 'Retry-After': '7' },
      }),
    });
    renderApp('/accounts');
    const dialog = await openArchive(user);
    await user.click(within(dialog).getByRole('button', { name: es.accounts['archive.confirm'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors.RATE_LIMITED);
  });
});

describe('accounts screen in English', () => {
  it('renders in English too', async () => {
    const { loadAccountsCatalog } = await import('@iam/i18n');
    const en = (await loadAccountsCatalog())['en-US'];
    setup();
    renderApp('/accounts', 'en-US');
    expect(await screen.findByRole('table', { name: en.caption })).toBeInTheDocument();
    await rowsLoaded();
    expect(screen.getByText(en['level.MANAGE'])).toBeInTheDocument();
  });
});
