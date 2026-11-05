import type {
  InboundConfigurableView,
  InboundSourceSummary,
  InboundTemplateSummary,
  Permission,
} from '@iam/contracts';
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

const MANAGE_SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const EDIT_SOURCE_ID = '11111111-1111-4111-8111-111111111112';
const USE_SOURCE_ID = '11111111-1111-4111-8111-111111111113';
const ARCHIVED_SOURCE_ID = '11111111-1111-4111-8111-111111111114';

const MANAGE_VIEW_ID = '22222222-2222-4222-8222-222222222221';
const EDIT_VIEW_ID = '22222222-2222-4222-8222-222222222222';
const USE_VIEW_ID = '22222222-2222-4222-8222-222222222223';
const NEW_VIEW_ID = '22222222-2222-4222-8222-222222222224';

const LOGIN_TEMPLATE_ID = '33333333-3333-4333-8333-333333333331';
const RESET_TEMPLATE_ID = '33333333-3333-4333-8333-333333333332';
const LINK_TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';

const PAGE = '/inbound/view-settings';
const VIEWS_PATH = '/inbound/configurable-views';
const CREATE_PATH = '/inbound/views';
const PERMISSIONS: Permission[] = ['inbound.configure'];

const withName = (template: string, name: string) => template.replace('{{name}}', name);

const sourceFixture = (overrides: Partial<InboundSourceSummary> = {}): InboundSourceSummary => ({
  id: MANAGE_SOURCE_ID,
  channel: 'mail',
  address: 'accesos@example.com',
  displayName: 'Buzón de accesos',
  accountId: null,
  status: 'active',
  createdAt: '2026-01-01T12:00:00.000Z',
  level: 'MANAGE',
  ...overrides,
});

const MANAGE_SOURCE = sourceFixture();
const EDIT_SOURCE = sourceFixture({
  id: EDIT_SOURCE_ID,
  address: 'soporte@example.com',
  displayName: 'Buzón de soporte',
  level: 'EDIT',
});
const USE_SOURCE = sourceFixture({
  id: USE_SOURCE_ID,
  address: 'ventas@example.com',
  displayName: 'Buzón de ventas',
  level: 'USE',
});
const ARCHIVED_SOURCE = sourceFixture({
  id: ARCHIVED_SOURCE_ID,
  address: 'viejo@example.com',
  displayName: 'Buzón archivado',
  status: 'archived',
});

const viewFixture = (
  overrides: Partial<InboundConfigurableView> = {},
): InboundConfigurableView => ({
  id: MANAGE_VIEW_ID,
  sourceId: MANAGE_SOURCE_ID,
  name: 'Vista de accesos',
  templateIds: [LOGIN_TEMPLATE_ID],
  createdAt: '2026-02-01T12:00:00.000Z',
  level: 'MANAGE',
  ...overrides,
});

const MANAGED_VIEW = viewFixture();
const EDITABLE_VIEW = viewFixture({
  id: EDIT_VIEW_ID,
  sourceId: EDIT_SOURCE_ID,
  name: 'Vista de soporte',
  templateIds: [LOGIN_TEMPLATE_ID, RESET_TEMPLATE_ID],
  level: 'EDIT',
});
const USABLE_VIEW = viewFixture({
  id: USE_VIEW_ID,
  sourceId: USE_SOURCE_ID,
  name: 'Vista de ventas',
  level: 'USE',
});

const TEMPLATES: InboundTemplateSummary[] = [
  { id: LOGIN_TEMPLATE_ID, name: 'Acceso genérico', kind: 'login_code' },
  { id: RESET_TEMPLATE_ID, name: 'Restablecer clave', kind: 'reset_code' },
  { id: LINK_TEMPLATE_ID, name: 'Enlace de recuperación', kind: 'reset_link' },
];

type Routes = Parameters<typeof stubApi>[0];

function setup(
  routes: Routes = {},
  views: InboundConfigurableView[] = [MANAGED_VIEW, EDITABLE_VIEW, USABLE_VIEW],
  sources: InboundSourceSummary[] = [MANAGE_SOURCE, EDIT_SOURCE, USE_SOURCE, ARCHIVED_SOURCE],
) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: PERMISSIONS, rank: 2 })),
    [`GET ${VIEWS_PATH}`]: jsonResponse({ data: views }),
    'GET /inbound/sources': jsonResponse({ data: sources }),
    'GET /inbound/templates': jsonResponse({ data: TEMPLATES }),
    'GET /inbound/views': jsonResponse({ data: [] }),
    ...routes,
  });
}

async function rowsLoaded(): Promise<void> {
  await screen.findByRole('cell', { name: 'Vista de accesos' });
}

const KIND_KEYS = {
  login_code: 'templateKind.login_code',
  reset_code: 'templateKind.reset_code',
  reset_link: 'templateKind.reset_link',
} as const;

const templateLabel = (name: string, kind: keyof typeof KIND_KEYS) =>
  t['viewSettings.template.label']
    .replace('{{name}}', name)
    .replace('{{kind}}', t[KIND_KEYS[kind]]);

const loginLabel = templateLabel('Acceso genérico', 'login_code');
const resetLabel = templateLabel('Restablecer clave', 'reset_code');
const linkLabel = templateLabel('Enlace de recuperación', 'reset_link');

const editLabel = (name: string) => withName(t['viewSettings.action.editLabel'], name);
const archiveLabel = (name: string) => withName(t['viewSettings.action.archiveLabel'], name);

describe('view settings list', () => {
  it('renders each view with its source name and translated level', async () => {
    setup();
    renderApp(PAGE);
    await rowsLoaded();
    const table = screen.getByRole('table');

    const managedRow = screen.getByRole('row', { name: /Vista de accesos/ });
    expect(within(managedRow).getByText('Buzón de accesos')).toBeVisible();
    expect(within(managedRow).getByText(t['level.MANAGE'])).toBeVisible();
    expect(within(managedRow).getByText('1')).toBeVisible();
    const editableRow = screen.getByRole('row', { name: /Vista de soporte/ });
    expect(within(editableRow).getByText('Buzón de soporte')).toBeVisible();
    expect(within(editableRow).getByText(t['level.EDIT'])).toBeVisible();
    expect(within(editableRow).getByText('2')).toBeVisible();
    expect(await axeViolations(table)).toEqual([]);
  });

  it('shows the empty state when there are no views', async () => {
    setup({}, []);
    renderApp(PAGE);
    expect(await screen.findByText(t['viewSettings.empty.title'])).toBeVisible();
  });

  it('shows the error state when the list answers 403', async () => {
    setup({ [`GET ${VIEWS_PATH}`]: problem(403, 'AUTHZ.SHARE') });
    renderApp(PAGE);
    expect(await screen.findByText(new RegExp(es.errors['AUTHZ.SHARE']))).toBeVisible();
  });

  it('offers edit from EDIT and archive only at MANAGE', async () => {
    setup();
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.getByRole('button', { name: editLabel('Vista de accesos') })).toBeVisible();
    expect(screen.getByRole('button', { name: archiveLabel('Vista de accesos') })).toBeVisible();
    expect(screen.getByRole('button', { name: editLabel('Vista de soporte') })).toBeVisible();
    expect(screen.queryByRole('button', { name: archiveLabel('Vista de soporte') })).toBeNull();
    expect(screen.queryByRole('button', { name: editLabel('Vista de ventas') })).toBeNull();
    expect(screen.queryByRole('button', { name: archiveLabel('Vista de ventas') })).toBeNull();
  });
});

describe('create view', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    const open = screen.getByRole('button', { name: t['viewSettings.create.open'] });
    await waitFor(() => {
      expect(open).toBeEnabled();
    });
    await user.click(open);
    return screen.findByRole('dialog', { name: t['viewSettings.create.title'] });
  }

  it('offers only active sources with EDIT or MANAGE access', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    const dialog = await openCreate(user);

    const options = within(field(t['viewSettings.form.source'])).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      t['viewSettings.form.sourcePlaceholder'],
      'Buzón de accesos',
      'Buzón de soporte',
    ]);
    expect(within(dialog).getByRole('group', { name: /Plantillas/ })).toBeVisible();
  });

  it('disables creation and explains why when no source qualifies', async () => {
    setup({}, [MANAGED_VIEW], [USE_SOURCE, ARCHIVED_SOURCE]);
    renderApp(PAGE);
    await rowsLoaded();
    expect(await screen.findByText(t['viewSettings.create.noSources'])).toBeVisible();
    expect(screen.getByRole('button', { name: t['viewSettings.create.open'] })).toBeDisabled();
  });

  it('sends the exact body with an idempotency key, then refreshes the list', async () => {
    const user = userEvent.setup();
    let created = false;
    const createdView = viewFixture({
      id: NEW_VIEW_ID,
      sourceId: EDIT_SOURCE_ID,
      name: 'Vista nueva',
      templateIds: [LOGIN_TEMPLATE_ID, LINK_TEMPLATE_ID],
      level: 'EDIT',
    });
    const api = setup({
      [`GET ${VIEWS_PATH}`]: () =>
        jsonResponse({ data: created ? [MANAGED_VIEW, createdView] : [MANAGED_VIEW] }),
      [`POST ${CREATE_PATH}`]: () => {
        created = true;
        return jsonResponse(
          {
            id: NEW_VIEW_ID,
            sourceId: EDIT_SOURCE_ID,
            name: 'Vista nueva',
            templateIds: [LOGIN_TEMPLATE_ID, LINK_TEMPLATE_ID],
            createdAt: '2026-03-01T12:00:00.000Z',
          },
          201,
        );
      },
    });
    renderApp(PAGE);
    const dialog = await openCreate(user);
    expect(await axeViolations(dialog)).toEqual([]);

    await user.selectOptions(field(t['viewSettings.form.source']), EDIT_SOURCE_ID);
    await user.type(field(t['viewSettings.form.name']), '  Vista nueva  ');
    await user.click(within(dialog).getByRole('checkbox', { name: loginLabel }));
    await user.click(within(dialog).getByRole('checkbox', { name: linkLabel }));
    await user.click(within(dialog).getByRole('button', { name: t['viewSettings.create.submit'] }));

    expect(
      await screen.findByText(withName(t['viewSettings.create.toast'], 'Vista nueva')),
    ).toBeInTheDocument();
    const call = api.callsTo('POST', CREATE_PATH)[0];
    expect(call?.body).toEqual({
      sourceId: EDIT_SOURCE_ID,
      name: 'Vista nueva',
      templateIds: [LOGIN_TEMPLATE_ID, LINK_TEMPLATE_ID],
    });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await screen.findByRole('cell', { name: 'Vista nueva' })).toBeVisible();
  });

  it('blocks sending when no template is selected', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    const dialog = await openCreate(user);

    await user.selectOptions(field(t['viewSettings.form.source']), MANAGE_SOURCE_ID);
    await user.type(field(t['viewSettings.form.name']), 'Sin plantillas');
    await user.click(within(dialog).getByRole('button', { name: t['viewSettings.create.submit'] }));

    expect(await within(dialog).findByText(t['viewSettings.form.templatesRequired'])).toBeVisible();
    expect(api.callsTo('POST', CREATE_PATH)).toHaveLength(0);
  });

  it('blocks sending when the name is empty', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    const dialog = await openCreate(user);

    await user.selectOptions(field(t['viewSettings.form.source']), MANAGE_SOURCE_ID);
    await user.click(within(dialog).getByRole('checkbox', { name: loginLabel }));
    await user.click(within(dialog).getByRole('button', { name: t['viewSettings.create.submit'] }));

    await waitFor(() => {
      expect(field(t['viewSettings.form.name'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(api.callsTo('POST', CREATE_PATH)).toHaveLength(0);
  });

  it('shows INBOUND.VIEW_NAME_TAKEN inside the dialog', async () => {
    const user = userEvent.setup();
    setup({ [`POST ${CREATE_PATH}`]: problem(409, 'INBOUND.VIEW_NAME_TAKEN') });
    renderApp(PAGE);
    const dialog = await openCreate(user);

    await user.selectOptions(field(t['viewSettings.form.source']), MANAGE_SOURCE_ID);
    await user.type(field(t['viewSettings.form.name']), 'Repetida');
    await user.click(within(dialog).getByRole('checkbox', { name: loginLabel }));
    await user.click(within(dialog).getByRole('button', { name: t['viewSettings.create.submit'] }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['INBOUND.VIEW_NAME_TAKEN'],
    );
  });
});

describe('edit view', () => {
  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: editLabel('Vista de soporte') }));
    const dialog = await screen.findByRole('dialog', {
      name: withName(t['viewSettings.edit.title'], 'Vista de soporte'),
    });
    // Las plantillas llegan por otra consulta; el grupo ya trae marcadas las de la vista.
    await within(dialog).findByRole('checkbox', { name: loginLabel });
    return dialog;
  }

  const editPath = `${CREATE_PATH}/${EDIT_VIEW_ID}`;
  const savedView = (overrides: Record<string, unknown>) =>
    jsonResponse({
      id: EDIT_VIEW_ID,
      sourceId: EDIT_SOURCE_ID,
      name: 'Vista de soporte',
      templateIds: [LOGIN_TEMPLATE_ID, RESET_TEMPLATE_ID],
      createdAt: '2026-02-01T12:00:00.000Z',
      ...overrides,
    });

  it('sends only the name when only the name changed', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH ${editPath}`]: savedView({ name: 'Soporte TI' }) });
    renderApp(PAGE);
    const dialog = await openEdit(user);
    expect(await axeViolations(dialog)).toEqual([]);

    const input = field(t['viewSettings.form.name']);
    await user.clear(input);
    await user.type(input, 'Soporte TI');
    await user.click(within(dialog).getByRole('button', { name: t['viewSettings.edit.submit'] }));

    expect(
      await screen.findByText(withName(t['viewSettings.edit.toast'], 'Soporte TI')),
    ).toBeInTheDocument();
    const call = api.callsTo('PATCH', editPath)[0];
    expect(call?.body).toEqual({ name: 'Soporte TI' });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('sends only the templates when only the templates changed', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`PATCH ${editPath}`]: savedView({ templateIds: [LOGIN_TEMPLATE_ID, LINK_TEMPLATE_ID] }),
    });
    renderApp(PAGE);
    const dialog = await openEdit(user);

    expect(within(dialog).getByRole('checkbox', { name: resetLabel })).toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: resetLabel }));
    await user.click(within(dialog).getByRole('checkbox', { name: linkLabel }));
    await user.click(within(dialog).getByRole('button', { name: t['viewSettings.edit.submit'] }));

    await screen.findByText(withName(t['viewSettings.edit.toast'], 'Vista de soporte'));
    const call = api.callsTo('PATCH', editPath)[0];
    expect(call?.body).toEqual({ templateIds: [LOGIN_TEMPLATE_ID, LINK_TEMPLATE_ID] });
  });

  it('sends nothing and closes when nothing changed', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH ${editPath}`]: savedView({}) });
    renderApp(PAGE);
    const dialog = await openEdit(user);

    await user.click(within(dialog).getByRole('button', { name: t['viewSettings.edit.submit'] }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('PATCH', editPath)).toHaveLength(0);
  });

  it('does not offer edit at USE', async () => {
    setup();
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: editLabel('Vista de ventas') })).toBeNull();
  });
});

describe('archive view', () => {
  async function openArchive(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: archiveLabel('Vista de accesos') }));
    return screen.findByRole('dialog', {
      name: withName(t['viewSettings.archive.title'], 'Vista de accesos'),
    });
  }

  it('warns that shares are revoked and archives with POST .../archive after confirming', async () => {
    const user = userEvent.setup();
    let archived = false;
    const archivePath = `${CREATE_PATH}/${MANAGE_VIEW_ID}/archive`;
    const api = setup({
      [`GET ${VIEWS_PATH}`]: () =>
        jsonResponse({ data: archived ? [EDITABLE_VIEW] : [MANAGED_VIEW, EDITABLE_VIEW] }),
      [`POST ${archivePath}`]: () => {
        archived = true;
        return noContent();
      },
    });
    renderApp(PAGE);
    const dialog = await openArchive(user);
    expect(within(dialog).getByText(t['viewSettings.archive.description'])).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);
    expect(api.callsTo('POST', archivePath)).toHaveLength(0);

    await user.click(
      within(dialog).getByRole('button', { name: t['viewSettings.archive.confirm'] }),
    );

    expect(
      await screen.findByText(withName(t['viewSettings.archive.toast'], 'Vista de accesos')),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', archivePath)).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Vista de accesos' })).toBeNull();
    });
  });
});
