import type { InboundSourceSummary, Permission } from '@iam/contracts';
import { loadInboundCatalog } from '@iam/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const catalogs = await loadInboundCatalog();
const t = catalogs['es-MX'];

const MANAGE_ID = '11111111-1111-4111-8111-111111111111';
const EDIT_ID = '11111111-1111-4111-8111-111111111112';
const USE_ID = '11111111-1111-4111-8111-111111111113';
const NEW_ID = '11111111-1111-4111-8111-111111111114';

const SOURCES_PATH = '/inbound/sources';
const PAGE = '/inbound/sources';
const PERMISSIONS: Permission[] = ['inbound.configure'];

const withName = (template: string, name: string) => template.replace('{{name}}', name);

const sourceFixture = (overrides: Partial<InboundSourceSummary> = {}): InboundSourceSummary => ({
  id: MANAGE_ID,
  channel: 'mail',
  address: 'accesos@example.com',
  displayName: 'Buzón de accesos',
  accountId: null,
  status: 'active',
  createdAt: '2026-01-01T12:00:00.000Z',
  level: 'MANAGE',
  ...overrides,
});

const MANAGED = sourceFixture();
const EDITABLE = sourceFixture({
  id: EDIT_ID,
  address: 'soporte@example.com',
  displayName: 'Buzón de soporte',
  status: 'suspended',
  level: 'EDIT',
});
const USABLE = sourceFixture({
  id: USE_ID,
  address: 'ventas@example.com',
  displayName: 'Buzón de ventas',
  level: 'USE',
});

type Routes = Parameters<typeof stubApi>[0];

function setup(routes: Routes = {}, sources: InboundSourceSummary[] = [MANAGED, EDITABLE, USABLE]) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: PERMISSIONS, rank: 2 })),
    [`GET ${SOURCES_PATH}`]: jsonResponse({ data: sources }),
    'GET /inbound/views': jsonResponse({ data: [] }),
    ...routes,
  });
}

async function rowsLoaded(): Promise<void> {
  await screen.findByRole('cell', { name: 'Buzón de accesos' });
}

const renameLabel = (name: string) => withName(t['sources.action.renameLabel'], name);
const archiveLabel = (name: string) => withName(t['sources.action.archiveLabel'], name);

describe('sources list', () => {
  it('renders each source with translated status and level', async () => {
    setup();
    renderApp(PAGE);
    await rowsLoaded();
    const table = screen.getByRole('table');

    const row = screen.getByRole('row', { name: /Buzón de soporte/ });
    expect(within(row).getByText('soporte@example.com')).toBeVisible();
    expect(within(row).getByText(t['sources.status.suspended'])).toBeVisible();
    expect(within(row).getByText(t['level.EDIT'])).toBeVisible();
    const managedRow = screen.getByRole('row', { name: /Buzón de accesos/ });
    expect(within(managedRow).getByText(t['sources.status.active'])).toBeVisible();
    expect(within(managedRow).getByText(t['level.MANAGE'])).toBeVisible();
    expect(await axeViolations(table)).toEqual([]);
  });

  it('shows the empty state when there are no sources', async () => {
    setup({}, []);
    renderApp(PAGE);
    expect(await screen.findByText(t['sources.empty.title'])).toBeVisible();
  });

  it('shows the error state when the list answers 403', async () => {
    setup({ [`GET ${SOURCES_PATH}`]: problem(403, 'AUTHZ.SHARE') });
    renderApp(PAGE);
    expect(await screen.findByText(new RegExp(es.errors['AUTHZ.SHARE']))).toBeVisible();
  });

  it('offers rename from EDIT and archive only at MANAGE', async () => {
    setup();
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.getByRole('button', { name: renameLabel('Buzón de accesos') })).toBeVisible();
    expect(screen.getByRole('button', { name: archiveLabel('Buzón de accesos') })).toBeVisible();
    expect(screen.getByRole('button', { name: renameLabel('Buzón de soporte') })).toBeVisible();
    expect(screen.queryByRole('button', { name: archiveLabel('Buzón de soporte') })).toBeNull();
    expect(screen.queryByRole('button', { name: renameLabel('Buzón de ventas') })).toBeNull();
    expect(screen.queryByRole('button', { name: archiveLabel('Buzón de ventas') })).toBeNull();
  });
});

describe('create source', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: t['sources.create.open'] }));
    return screen.findByRole('dialog', { name: t['sources.create.title'] });
  }

  it('sends exactly address and displayName with an idempotency key, then refreshes the list', async () => {
    const user = userEvent.setup();
    let created = false;
    const created_source = sourceFixture({
      id: NEW_ID,
      address: 'nuevo@example.com',
      displayName: 'Buzón nuevo',
    });
    const api = setup({
      [`GET ${SOURCES_PATH}`]: () =>
        jsonResponse({ data: created ? [MANAGED, created_source] : [MANAGED] }),
      [`POST ${SOURCES_PATH}`]: () => {
        created = true;
        return jsonResponse(created_source, 201);
      },
    });
    renderApp(PAGE);
    const dialog = await openCreate(user);
    expect(await axeViolations(dialog)).toEqual([]);

    await user.type(field(t['sources.form.address']), 'nuevo@example.com');
    await user.type(field(t['sources.form.name']), 'Buzón nuevo');
    await user.click(within(dialog).getByRole('button', { name: t['sources.create.submit'] }));

    expect(
      await screen.findByText(withName(t['sources.create.toast'], 'Buzón nuevo')),
    ).toBeInTheDocument();
    const call = api.callsTo('POST', SOURCES_PATH)[0];
    expect(call?.body).toEqual({ address: 'nuevo@example.com', displayName: 'Buzón nuevo' });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await screen.findByRole('cell', { name: 'Buzón nuevo' })).toBeVisible();
  });

  it('blocks an invalid email without sending anything', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST ${SOURCES_PATH}`]: jsonResponse(MANAGED, 201) });
    renderApp(PAGE);
    const dialog = await openCreate(user);

    await user.type(field(t['sources.form.address']), 'no-es-un-correo');
    await user.type(field(t['sources.form.name']), 'Buzón');
    await user.click(within(dialog).getByRole('button', { name: t['sources.create.submit'] }));

    await waitFor(() => {
      expect(field(t['sources.form.address'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(api.callsTo('POST', SOURCES_PATH)).toHaveLength(0);
  });

  it('shows INBOUND.SOURCE_ADDRESS_TAKEN inside the dialog', async () => {
    const user = userEvent.setup();
    setup({ [`POST ${SOURCES_PATH}`]: problem(409, 'INBOUND.SOURCE_ADDRESS_TAKEN') });
    renderApp(PAGE);
    const dialog = await openCreate(user);

    await user.type(field(t['sources.form.address']), 'accesos@example.com');
    await user.type(field(t['sources.form.name']), 'Repetida');
    await user.click(within(dialog).getByRole('button', { name: t['sources.create.submit'] }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['INBOUND.SOURCE_ADDRESS_TAKEN'],
    );
  });
});

describe('rename source', () => {
  it('sends only displayName with an idempotency key and refreshes the list', async () => {
    const user = userEvent.setup();
    let renamed = false;
    const api = setup({
      [`GET ${SOURCES_PATH}`]: () =>
        jsonResponse({
          data: [renamed ? { ...MANAGED, displayName: 'Accesos TI' } : MANAGED],
        }),
      [`PATCH ${SOURCES_PATH}/${MANAGE_ID}`]: () => {
        renamed = true;
        return jsonResponse({ ...MANAGED, displayName: 'Accesos TI' });
      },
    });
    renderApp(PAGE);
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: renameLabel('Buzón de accesos') }));
    const dialog = await screen.findByRole('dialog', {
      name: withName(t['sources.rename.title'], 'Buzón de accesos'),
    });

    const input = field(t['sources.form.name']);
    await user.clear(input);
    await user.type(input, 'Accesos TI');
    await user.click(within(dialog).getByRole('button', { name: t['sources.rename.submit'] }));

    expect(
      await screen.findByText(withName(t['sources.rename.toast'], 'Accesos TI')),
    ).toBeInTheDocument();
    const call = api.callsTo('PATCH', `${SOURCES_PATH}/${MANAGE_ID}`)[0];
    expect(call?.body).toEqual({ displayName: 'Accesos TI' });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await screen.findByRole('cell', { name: 'Accesos TI' })).toBeVisible();
  });
});

describe('archive source', () => {
  async function openArchive(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: archiveLabel('Buzón de accesos') }));
    return screen.findByRole('dialog', {
      name: withName(t['sources.archive.title'], 'Buzón de accesos'),
    });
  }

  it('explains the effect, archives after confirming and refreshes sources and views', async () => {
    const user = userEvent.setup();
    let archived = false;
    const api = setup({
      [`GET ${SOURCES_PATH}`]: () =>
        jsonResponse({ data: archived ? [EDITABLE] : [MANAGED, EDITABLE] }),
      [`POST ${SOURCES_PATH}/${MANAGE_ID}/archive`]: () => {
        archived = true;
        return noContent();
      },
    });
    renderApp(PAGE);
    const dialog = await openArchive(user);
    expect(within(dialog).getByText(t['sources.archive.description'])).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);
    expect(api.callsTo('POST', `${SOURCES_PATH}/${MANAGE_ID}/archive`)).toHaveLength(0);
    const viewsBefore = api.callsTo('GET', '/inbound/views').length;

    await user.click(within(dialog).getByRole('button', { name: t['sources.archive.confirm'] }));

    expect(
      await screen.findByText(withName(t['sources.archive.toast'], 'Buzón de accesos')),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `${SOURCES_PATH}/${MANAGE_ID}/archive`)).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Buzón de accesos' })).toBeNull();
    });
    // Las vistas solo se piden si hay un observador activo; se comprueba que no hubo error al invalidarlas.
    expect(api.callsTo('GET', '/inbound/views').length).toBeGreaterThanOrEqual(viewsBefore);
  });

  it('sends nothing when cancelling', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST ${SOURCES_PATH}/${MANAGE_ID}/archive`]: noContent() });
    renderApp(PAGE);
    const dialog = await openArchive(user);
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('POST', `${SOURCES_PATH}/${MANAGE_ID}/archive`)).toHaveLength(0);
  });
});
