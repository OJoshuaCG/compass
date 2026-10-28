import { PERMISSIONS, type Permission, type Role } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const SYSTEM_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOM_ID = '22222222-2222-4222-8222-222222222222';
const NEW_ID = '33333333-3333-4333-8333-333333333333';

const SYSTEM: Role = {
  id: SYSTEM_ID,
  name: 'Administrador base',
  isSystem: true,
  permissions: ['user.invite', 'role.manage'],
};
const CUSTOM: Role = {
  id: CUSTOM_ID,
  name: 'Soporte',
  isSystem: false,
  permissions: ['user.invite', 'audit.read_scope', 'credential.use_totp'],
};

const MINE: Permission[] = ['role.manage', 'user.invite', 'user.update', 'audit.read_scope'];

const label = (permission: string) =>
  (es.roles as Record<string, string>)[`permission.${permission}`] ?? permission;
const archiveLabel = (name: string) => es.roles['action.archiveLabel'].replace('{{name}}', name);
const editLabel = (name: string) => es.roles['action.editLabel'].replace('{{name}}', name);
const viewLabel = (name: string) => es.roles['action.viewLabel'].replace('{{name}}', name);
const rolesCalls = (api: ReturnType<typeof stubApi>) => api.callsTo('GET', '/roles');

function setup(
  extra: Record<string, Parameters<typeof stubApi>[0][string]> = {},
  permissions: Permission[] = MINE,
) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    'GET /roles': jsonResponse({ data: [SYSTEM, CUSTOM] }),
    ...extra,
  });
}

/** La tabla se pinta ya en su estado de carga: se espera a que lleguen las filas. */
const rowsLoaded = () => screen.findByRole('cell', { name: 'Soporte' });

describe('roles navigation', () => {
  it('shows the nav link only with role.manage and reaches the screen', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await user.click(await screen.findByRole('link', { name: es.common['nav.roles'] }));
    await rowsLoaded();
    expect(router.state.location.pathname).toBe('/roles');
  });

  it('hides the nav link without role.manage', async () => {
    setup({}, ['user.invite']);
    renderApp('/');
    await screen.findByRole('link', { name: es.common['nav.users'] });
    expect(screen.queryByRole('link', { name: es.common['nav.roles'] })).toBeNull();
  });

  it('answers as not found when the URL is opened without role.manage', async () => {
    const api = setup({}, ['user.invite']);
    renderApp('/roles');
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeInTheDocument();
    expect(rolesCalls(api)).toHaveLength(0);
  });
});

describe('roles table', () => {
  it('lists name, system/custom badge and permission count, without violations', async () => {
    setup();
    const { container } = renderApp('/roles');
    await rowsLoaded();
    const table = screen.getByRole('table', { name: es.roles.caption });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const system = within(rows[1] as HTMLElement);
    expect(system.getByText(es.roles['badge.system'])).toBeInTheDocument();
    expect(system.getByRole('cell', { name: '2' })).toBeInTheDocument();
    const custom = within(rows[2] as HTMLElement);
    expect(custom.getByText(es.roles['badge.custom'])).toBeInTheDocument();
    expect(custom.getByRole('cell', { name: '3' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows an empty state and a translated error with Retry', async () => {
    const user = userEvent.setup();
    let mode: 'empty' | 'fail' = 'fail';
    setup({
      'GET /roles': () => (mode === 'fail' ? problem(500, 'INTERNAL') : jsonResponse({ data: [] })),
    });
    renderApp('/roles');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.INTERNAL);
    mode = 'empty';
    await user.click(within(alert).getByRole('button', { name: es.common['actions.retry'] }));
    expect(await screen.findByText(es.roles['empty.title'])).toBeInTheDocument();
  });

  it('lists the permissions of a role grouped by area in a dialog', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/roles');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: viewLabel('Soporte') }));
    const dialog = await screen.findByRole('dialog', {
      name: es.roles['view.title'].replace('{{name}}', 'Soporte'),
    });
    expect(
      within(dialog).getByRole('heading', { name: es.roles['permission.group.audit'] }),
    ).toBeVisible();
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([label('user.invite'), label('credential.use_totp'), label('audit.read_scope')]);
    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('create role', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.roles['create.open'] }));
    return screen.findByRole('dialog', { name: es.roles['create.title'] });
  }

  it('offers only the permissions the user has, grouped by area, and sends the chosen ones', async () => {
    const user = userEvent.setup();
    let created = false;
    const api = setup({
      'GET /roles': () => jsonResponse({ data: created ? [SYSTEM, CUSTOM] : [SYSTEM] }),
      'POST /roles': () => {
        created = true;
        return jsonResponse({ ...CUSTOM, id: NEW_ID, name: 'Nuevo rol' }, 201);
      },
    });
    renderApp('/roles');
    await screen.findByRole('cell', { name: 'Administrador base' });
    await user.click(screen.getByRole('button', { name: es.roles['create.open'] }));
    const dialog = await screen.findByRole('dialog', { name: es.roles['create.title'] });
    const offered = within(dialog)
      .getAllByRole('checkbox')
      .map((box) => (box as HTMLInputElement).value);
    expect([...offered].sort()).toEqual([...MINE].sort());
    // Agrupado por área: cada área es un grupo con nombre.
    expect(
      within(dialog).getByRole('group', { name: es.roles['permission.group.user'] }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole('checkbox', { name: label('credential.reveal_password') }),
    ).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);

    await user.type(field(es.roles['create.name']), 'Nuevo rol');
    await user.click(within(dialog).getByRole('checkbox', { name: label('user.invite') }));
    await user.click(within(dialog).getByRole('checkbox', { name: label('audit.read_scope') }));
    await user.click(within(dialog).getByRole('button', { name: es.roles['create.submit'] }));

    expect(
      await screen.findByText(es.roles['create.toast'].replace('{{name}}', 'Nuevo rol')),
    ).toBeInTheDocument();
    const call = api.callsTo('POST', '/roles')[0];
    expect(call?.body).toEqual({
      name: 'Nuevo rol',
      permissions: ['user.invite', 'audit.read_scope'],
    });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('cell', { name: 'Soporte' })).toBeInTheDocument();
    });
  });

  it('requires a name and at least one permission, and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp('/roles');
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByRole('button', { name: es.roles['create.submit'] }));
    const alerts = await within(dialog).findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toContain(es.roles['create.permissionsRequired']);
    expect(alerts.map((a) => a.textContent)).toContain(es.common['validation.required']);
    expect(api.callsTo('POST', '/roles')).toHaveLength(0);
    expect(await axeViolations(dialog)).toEqual([]);

    // Tras el primer error, elegir un permiso limpia el aviso.
    await user.click(within(dialog).getByRole('checkbox', { name: label('user.invite') }));
    await waitFor(() => {
      expect(
        within(dialog).queryByText(es.roles['create.permissionsRequired'], {
          selector: 'p[role=alert]',
        }),
      ).toBeNull();
    });
  });

  it('shows ROLE.NAME_TAKEN on the name field and keeps the dialog open', async () => {
    const user = userEvent.setup();
    setup({ 'POST /roles': problem(409, 'ROLE.NAME_TAKEN') });
    renderApp('/roles');
    const dialog = await openCreate(user);
    await user.type(field(es.roles['create.name']), 'Soporte');
    await user.click(within(dialog).getByRole('checkbox', { name: label('user.invite') }));
    await user.click(within(dialog).getByRole('button', { name: es.roles['create.submit'] }));
    const nameField = field(es.roles['create.name']);
    await waitFor(() => {
      expect(nameField).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(dialog).getByText(es.errors['ROLE.NAME_TAKEN'])).toBeVisible();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows AUTHZ.ROLE_ESCALATION in the dialog', async () => {
    const user = userEvent.setup();
    setup({ 'POST /roles': problem(403, 'AUTHZ.ROLE_ESCALATION') });
    renderApp('/roles');
    const dialog = await openCreate(user);
    await user.type(field(es.roles['create.name']), 'Escalada');
    await user.click(within(dialog).getByRole('checkbox', { name: label('role.manage') }));
    await user.click(within(dialog).getByRole('button', { name: es.roles['create.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.ROLE_ESCALATION'],
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers the whole catalog to someone holding every permission', async () => {
    const user = userEvent.setup();
    setup({}, [...PERMISSIONS]);
    renderApp('/roles');
    const dialog = await openCreate(user);
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(PERMISSIONS.length);
  });

  it('has a Spanish and an English label for every permission and area', async () => {
    const { loadRolesCatalog } = await import('@iam/i18n');
    const catalog = await loadRolesCatalog();
    for (const locale of ['es-MX', 'en-US'] as const) {
      for (const permission of PERMISSIONS) {
        expect(catalog[locale], `${locale} ${permission}`).toHaveProperty(
          `permission.${permission}`,
        );
        expect(catalog[locale]).toHaveProperty(
          `permission.group.${permission.split('.')[0] ?? ''}`,
        );
      }
    }
  });
});

describe('archive role', () => {
  it('never offers Archive for system roles but does for custom ones', async () => {
    setup();
    renderApp('/roles');
    await rowsLoaded();
    expect(screen.getByRole('button', { name: archiveLabel('Soporte') })).toBeVisible();
    expect(screen.queryByRole('button', { name: archiveLabel('Administrador base') })).toBeNull();
    expect(screen.getByRole('button', { name: viewLabel('Administrador base') })).toBeVisible();
  });

  it('asks for confirmation, archives only that role and refetches the list', async () => {
    const user = userEvent.setup();
    let archived = false;
    const api = setup({
      'GET /roles': () => jsonResponse({ data: archived ? [SYSTEM] : [SYSTEM, CUSTOM] }),
      [`POST /roles/${CUSTOM_ID}/archive`]: () => {
        archived = true;
        return noContent();
      },
    });
    renderApp('/roles');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: archiveLabel('Soporte') }));
    const dialog = await screen.findByRole('dialog', {
      name: es.roles['archive.title'].replace('{{name}}', 'Soporte'),
    });
    expect(await axeViolations(dialog)).toEqual([]);
    expect(api.callsTo('POST', `/roles/${CUSTOM_ID}/archive`)).toHaveLength(0);
    const before = rolesCalls(api).length;

    await user.click(within(dialog).getByRole('button', { name: es.roles['archive.confirm'] }));

    expect(
      await screen.findByText(es.roles['archive.toast'].replace('{{name}}', 'Soporte')),
    ).toBeInTheDocument();
    expect(
      api.callsTo('POST', `/roles/${CUSTOM_ID}/archive`)[0]?.headers.get('Idempotency-Key'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(rolesCalls(api).length).toBeGreaterThan(before);
      expect(screen.queryByRole('cell', { name: 'Soporte' })).toBeNull();
    });
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /roles/${CUSTOM_ID}/archive`]: noContent() });
    renderApp('/roles');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: archiveLabel('Soporte') }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('POST', `/roles/${CUSTOM_ID}/archive`)).toHaveLength(0);
  });

  it('shows ROLE.SYSTEM_PROTECTED inside the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    setup({ [`POST /roles/${CUSTOM_ID}/archive`]: problem(403, 'ROLE.SYSTEM_PROTECTED') });
    renderApp('/roles');
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: archiveLabel('Soporte') }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.roles['archive.confirm'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['ROLE.SYSTEM_PROTECTED'],
    );
  });

  it('treats a 404 (already gone) as archived and refreshes', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /roles/${CUSTOM_ID}/archive`]: problem(404, 'NOT_FOUND') });
    renderApp('/roles');
    await rowsLoaded();
    const before = rolesCalls(api).length;
    await user.click(screen.getByRole('button', { name: archiveLabel('Soporte') }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.roles['archive.confirm'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(rolesCalls(api).length).toBeGreaterThan(before);
    });
  });
});

describe('edit role', () => {
  // Quien edita debe tener TODOS los permisos actuales del rol (ADR 0012): a `Soporte` le suma uno.
  const EDITOR: Permission[] = [...MINE, 'credential.use_totp'];
  const editTitle = (name: string) => es.roles['edit.title'].replace('{{name}}', name);

  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: editLabel('Soporte') }));
    return screen.findByRole('dialog', { name: editTitle('Soporte') });
  }

  it('offers Edit for custom roles only', async () => {
    setup({}, EDITOR);
    renderApp('/roles');
    await rowsLoaded();
    expect(screen.getByRole('button', { name: editLabel('Soporte') })).toBeVisible();
    expect(screen.queryByRole('button', { name: editLabel('Administrador base') })).toBeNull();
  });

  it('opens with the current name and permissions and sends the full replacement', async () => {
    const user = userEvent.setup();
    let updated = false;
    const api = setup(
      {
        'GET /roles': () =>
          jsonResponse({
            data: [SYSTEM, updated ? { ...CUSTOM, name: 'Soporte N2' } : CUSTOM],
          }),
        [`PATCH /roles/${CUSTOM_ID}`]: () => {
          updated = true;
          return jsonResponse({ ...CUSTOM, name: 'Soporte N2', permissions: ['user.invite'] });
        },
      },
      EDITOR,
    );
    renderApp('/roles');
    const dialog = await openEdit(user);
    expect(field(es.roles['create.name'])).toHaveValue('Soporte');
    for (const permission of CUSTOM.permissions) {
      expect(within(dialog).getByRole('checkbox', { name: label(permission) })).toBeChecked();
    }
    expect(within(dialog).getByRole('checkbox', { name: label('user.update') })).not.toBeChecked();
    expect(await axeViolations(dialog)).toEqual([]);

    await user.clear(field(es.roles['create.name']));
    await user.type(field(es.roles['create.name']), 'Soporte N2');
    await user.click(within(dialog).getByRole('checkbox', { name: label('audit.read_scope') }));
    await user.click(within(dialog).getByRole('checkbox', { name: label('credential.use_totp') }));
    await user.click(within(dialog).getByRole('button', { name: es.roles['edit.submit'] }));

    expect(
      await screen.findByText(es.roles['edit.toast'].replace('{{name}}', 'Soporte N2')),
    ).toBeInTheDocument();
    const call = api.callsTo('PATCH', `/roles/${CUSTOM_ID}`)[0];
    expect(call?.body).toEqual({ name: 'Soporte N2', permissions: ['user.invite'] });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('cell', { name: 'Soporte N2' })).toBeInTheDocument();
    });
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH /roles/${CUSTOM_ID}`]: jsonResponse(CUSTOM) }, EDITOR);
    renderApp('/roles');
    const dialog = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('PATCH', `/roles/${CUSTOM_ID}`)).toHaveLength(0);
  });

  it('requires at least one permission and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH /roles/${CUSTOM_ID}`]: jsonResponse(CUSTOM) }, EDITOR);
    renderApp('/roles');
    const dialog = await openEdit(user);
    for (const permission of CUSTOM.permissions) {
      await user.click(within(dialog).getByRole('checkbox', { name: label(permission) }));
    }
    await user.click(within(dialog).getByRole('button', { name: es.roles['edit.submit'] }));
    const alerts = await within(dialog).findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toContain(es.roles['create.permissionsRequired']);
    expect(api.callsTo('PATCH', `/roles/${CUSTOM_ID}`)).toHaveLength(0);
  });

  it('shows ROLE.NAME_TAKEN on the name field and keeps the dialog open', async () => {
    const user = userEvent.setup();
    setup({ [`PATCH /roles/${CUSTOM_ID}`]: problem(409, 'ROLE.NAME_TAKEN') }, EDITOR);
    renderApp('/roles');
    const dialog = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: es.roles['edit.submit'] }));
    await waitFor(() => {
      expect(field(es.roles['create.name'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(dialog).getByText(es.errors['ROLE.NAME_TAKEN'])).toBeVisible();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows AUTHZ.ROLE_ESCALATION from the server in the dialog', async () => {
    const user = userEvent.setup();
    setup({ [`PATCH /roles/${CUSTOM_ID}`]: problem(403, 'AUTHZ.ROLE_ESCALATION') }, EDITOR);
    renderApp('/roles');
    const dialog = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: es.roles['edit.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.ROLE_ESCALATION'],
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('warns and blocks saving when the role has permissions the editor lacks', async () => {
    const user = userEvent.setup();
    // MINE no incluye `credential.use_totp`, que `Soporte` sí tiene.
    const api = setup({ [`PATCH /roles/${CUSTOM_ID}`]: jsonResponse(CUSTOM) });
    renderApp('/roles');
    const dialog = await openEdit(user);
    expect(within(dialog).getByText(es.roles['edit.missingPermissions'])).toBeVisible();
    expect(within(dialog).getByRole('button', { name: es.roles['edit.submit'] })).toBeDisabled();
    expect(api.callsTo('PATCH', `/roles/${CUSTOM_ID}`)).toHaveLength(0);
    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('roles screen in English', () => {
  it('renders in English too', async () => {
    const { loadRolesCatalog } = await import('@iam/i18n');
    const en = (await loadRolesCatalog())['en-US'];
    setup();
    renderApp('/roles', 'en-US');
    expect(await screen.findByRole('table', { name: en.caption })).toBeInTheDocument();
    await rowsLoaded();
    expect(screen.getByText(en['badge.system'])).toBeInTheDocument();
  });
});
