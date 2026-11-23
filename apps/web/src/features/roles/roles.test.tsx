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
// Quien edita debe tener TODOS los permisos actuales del rol (ADR 0012): a `Soporte` le suma uno.
const EDITOR: Permission[] = [...MINE, 'credential.use_totp'];

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
    template,
  );
const label = (permission: string) =>
  (es.roles as Record<string, string>)[`permission.${permission}`] ?? permission;
const cardLabel = (name: string) => fill(es.roles['card.openLabel'], { name });
const rolesCalls = (api: ReturnType<typeof stubApi>) => api.callsTo('GET', '/roles');
const archiveOption = new RegExp(`^${es.roles['archive.confirm']}`);

function setup(
  extra: Record<string, Parameters<typeof stubApi>[0][string]> = {},
  permissions: Permission[] = MINE,
) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    'GET /roles': jsonResponse({ data: [SYSTEM, CUSTOM], page: { nextCursor: null, limit: 25 } }),
    ...extra,
  });
}

/** Las tarjetas llegan después del estado de carga: se espera a la del rol personalizado. */
const rowsLoaded = () => screen.findByRole('link', { name: cardLabel('Soporte') });

/** Abre el editor de un rol desde su tarjeta y devuelve el contenido principal de la página. */
async function openEditor(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('link', { name: cardLabel(name) }));
  await screen.findByRole('heading', { level: 1, name });
  return screen.getByRole('main');
}

/** "Nuevo rol" desde la lista: devuelve el contenido principal del editor vacío. */
async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await rowsLoaded();
  await user.click(screen.getByRole('link', { name: es.roles['create.open'] }));
  await screen.findByRole('heading', { level: 1, name: es.roles['editor.newTitle'] });
  return screen.getByRole('main');
}

/** Editor de Soporte y luego "Archivar rol": devuelve el diálogo de confirmación. */
async function openArchive(user: ReturnType<typeof userEvent.setup>) {
  const page = await openEditor(user, 'Soporte');
  await user.click(within(page).getByRole('button', { name: archiveOption }));
  return screen.findByRole('dialog', {
    name: fill(es.roles['archive.title'], { name: 'Soporte' }),
  });
}

describe('roles navigation', () => {
  it('shows the People section tab only with role.manage and reaches the screen', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await user.click(await screen.findByRole('link', { name: es.common['nav.people'] }));
    await user.click(await screen.findByRole('link', { name: es.common['nav.roles'] }));
    await rowsLoaded();
    expect(router.state.location.pathname).toBe('/roles');
  });

  it('hides the section tab without role.manage', async () => {
    setup({}, ['user.invite']);
    renderApp('/users');
    await screen.findByRole('link', { name: es.common['nav.people'] });
    expect(screen.queryByRole('link', { name: es.common['nav.roles'] })).toBeNull();
  });

  it('answers as not found when the URL is opened without role.manage', async () => {
    const api = setup({}, ['user.invite']);
    renderApp('/roles');
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeInTheDocument();
    expect(rolesCalls(api)).toHaveLength(0);
  });

  it('answers as not found for the editor URLs without role.manage', async () => {
    const api = setup({}, ['user.invite']);
    renderApp(`/roles/${CUSTOM_ID}`);
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeInTheDocument();
    expect(rolesCalls(api)).toHaveLength(0);
  });

  it('answers as not found for an id that is not a UUID, without calling the API', async () => {
    const api = setup();
    renderApp('/roles/not-a-uuid');
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeInTheDocument();
    expect(rolesCalls(api)).toHaveLength(0);
  });

  it('says the role no longer exists when it is not in the list', async () => {
    setup();
    renderApp(`/roles/${NEW_ID}`);
    expect(await screen.findByText(es.roles['editor.notFound'])).toBeVisible();
    expect(screen.getByRole('link', { name: es.roles['editor.back'] })).toBeVisible();
  });
});

describe('roles cards', () => {
  it('shows one card per role with its kind, areas and permission count, without violations', async () => {
    setup();
    const { container } = renderApp('/roles');
    await rowsLoaded();
    const list = screen.getByRole('list', { name: es.roles.caption });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const system = within(cards[0] as HTMLElement);
    expect(system.getByText(es.roles['kind.system'])).toBeInTheDocument();
    expect(cards[0]).toHaveTextContent(`2 ${es.roles['card.permissions_other']}`);
    const custom = within(cards[1] as HTMLElement);
    expect(custom.getByText(es.roles['kind.custom'])).toBeInTheDocument();
    expect(cards[1]).toHaveTextContent(`3 ${es.roles['card.permissions_other']}`);
    // Las áreas resumen el rol, en el orden del catálogo.
    expect(
      custom.getByText(
        [
          es.roles['permission.group.user'],
          es.roles['permission.group.credential'],
          es.roles['permission.group.audit'],
        ].join(' · '),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: cardLabel('Soporte') })).toHaveAccessibleDescription(
      new RegExp(es.roles['kind.custom']),
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows an empty state and a translated error with Retry', async () => {
    const user = userEvent.setup();
    let mode: 'empty' | 'fail' = 'fail';
    setup({
      'GET /roles': () =>
        mode === 'fail'
          ? problem(500, 'INTERNAL')
          : jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    });
    renderApp('/roles');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.INTERNAL);
    mode = 'empty';
    await user.click(within(alert).getByRole('button', { name: es.common['actions.retry'] }));
    expect(await screen.findByText(es.roles['empty.title'])).toBeInTheDocument();
  });

  it('opens the editor page of a role with its permissions by area, without violations', async () => {
    const user = userEvent.setup();
    setup({}, EDITOR);
    const { router, container } = renderApp('/roles');
    const page = await openEditor(user, 'Soporte');
    expect(router.state.location.pathname).toBe(`/roles/${CUSTOM_ID}`);
    expect(within(page).getByText(es.roles['kind.custom'])).toBeVisible();
    expect(
      within(page).getByText(fill(es.roles['editor.selected_other'], { count: 3 })),
    ).toBeVisible();
    expect(
      within(page).getByRole('group', { name: es.roles['permission.group.audit'] }),
    ).toBeVisible();
    for (const permission of CUSTOM.permissions) {
      expect(within(page).getByRole('checkbox', { name: label(permission) })).toBeChecked();
    }
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('create role', () => {
  it('offers only the permissions the user has, grouped by area, and sends the chosen ones', async () => {
    const user = userEvent.setup();
    let created = false;
    const api = setup({
      'GET /roles': () =>
        jsonResponse({
          data: created ? [SYSTEM, CUSTOM] : [SYSTEM],
          page: { nextCursor: null, limit: 25 },
        }),
      'POST /roles': () => {
        created = true;
        return jsonResponse({ ...CUSTOM, id: NEW_ID, name: 'Nuevo rol' }, 201);
      },
    });
    const { router, container } = renderApp('/roles');
    await screen.findByRole('link', { name: cardLabel('Administrador base') });
    await user.click(screen.getByRole('link', { name: es.roles['create.open'] }));
    await screen.findByRole('heading', { level: 1, name: es.roles['editor.newTitle'] });
    expect(router.state.location.pathname).toBe('/roles/new');
    const page = screen.getByRole('main');
    const offered = within(page)
      .getAllByRole('checkbox')
      .map((box) => (box as HTMLInputElement).value);
    expect([...offered].sort()).toEqual([...MINE].sort());
    // Agrupado por área: cada área es un grupo con nombre.
    expect(
      within(page).getByRole('group', { name: es.roles['permission.group.user'] }),
    ).toBeVisible();
    expect(
      within(page).queryByRole('checkbox', { name: label('credential.reveal_password') }),
    ).toBeNull();
    expect(await axeViolations(container)).toEqual([]);

    await user.type(field(es.roles['create.name']), 'Nuevo rol');
    await user.click(within(page).getByRole('checkbox', { name: label('user.invite') }));
    await user.click(within(page).getByRole('checkbox', { name: label('audit.read_scope') }));
    await user.click(within(page).getByRole('button', { name: es.roles['create.submit'] }));

    expect(
      await screen.findByText(fill(es.roles['create.toast'], { name: 'Nuevo rol' })),
    ).toBeInTheDocument();
    const call = api.callsTo('POST', '/roles')[0];
    expect(call?.body).toEqual({
      name: 'Nuevo rol',
      permissions: ['user.invite', 'audit.read_scope'],
    });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    // Vuelve a la lista, ya recargada.
    expect(await screen.findByRole('link', { name: cardLabel('Soporte') })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/roles');
  });

  it('selects and clears a whole area, only with permissions the user has', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/roles');
    const page = await openCreate(user);
    const area = es.roles['permission.group.user'];
    await user.click(
      within(page).getByRole('button', { name: fill(es.roles['editor.selectAllLabel'], { area }) }),
    );
    expect(within(page).getByRole('checkbox', { name: label('user.invite') })).toBeChecked();
    expect(within(page).getByRole('checkbox', { name: label('user.update') })).toBeChecked();
    // Otras áreas no cambian.
    expect(within(page).getByRole('checkbox', { name: label('role.manage') })).not.toBeChecked();
    await user.click(
      within(page).getByRole('button', { name: fill(es.roles['editor.clearAllLabel'], { area }) }),
    );
    expect(within(page).getByRole('checkbox', { name: label('user.invite') })).not.toBeChecked();
    expect(within(page).getByRole('checkbox', { name: label('user.update') })).not.toBeChecked();
  });

  it('requires a name and at least one permission, and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup();
    const { container } = renderApp('/roles');
    const page = await openCreate(user);
    await user.click(within(page).getByRole('button', { name: es.roles['create.submit'] }));
    const alerts = await within(page).findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toContain(es.roles['create.permissionsRequired']);
    expect(alerts.map((a) => a.textContent)).toContain(es.common['validation.required']);
    expect(api.callsTo('POST', '/roles')).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);

    // Tras el primer error, elegir un permiso limpia el aviso.
    await user.click(within(page).getByRole('checkbox', { name: label('user.invite') }));
    await waitFor(() => {
      expect(
        within(page).queryByText(es.roles['create.permissionsRequired'], {
          selector: 'p[role=alert]',
        }),
      ).toBeNull();
    });
  });

  it('shows ROLE.NAME_TAKEN on the name field and stays on the page', async () => {
    const user = userEvent.setup();
    setup({ 'POST /roles': problem(409, 'ROLE.NAME_TAKEN') });
    const { router } = renderApp('/roles');
    const page = await openCreate(user);
    await user.type(field(es.roles['create.name']), 'Soporte');
    await user.click(within(page).getByRole('checkbox', { name: label('user.invite') }));
    await user.click(within(page).getByRole('button', { name: es.roles['create.submit'] }));
    const nameField = field(es.roles['create.name']);
    await waitFor(() => {
      expect(nameField).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(page).getByText(es.errors['ROLE.NAME_TAKEN'])).toBeVisible();
    expect(router.state.location.pathname).toBe('/roles/new');
  });

  it('shows AUTHZ.ROLE_ESCALATION on the page', async () => {
    const user = userEvent.setup();
    setup({ 'POST /roles': problem(403, 'AUTHZ.ROLE_ESCALATION') });
    const { router } = renderApp('/roles');
    const page = await openCreate(user);
    await user.type(field(es.roles['create.name']), 'Escalada');
    await user.click(within(page).getByRole('checkbox', { name: label('role.manage') }));
    await user.click(within(page).getByRole('button', { name: es.roles['create.submit'] }));
    expect(await within(page).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.ROLE_ESCALATION'],
    );
    expect(router.state.location.pathname).toBe('/roles/new');
  });

  it('offers the whole catalog to someone holding every permission', async () => {
    const user = userEvent.setup();
    setup({}, [...PERMISSIONS]);
    renderApp('/roles');
    const page = await openCreate(user);
    expect(within(page).getAllByRole('checkbox')).toHaveLength(PERMISSIONS.length);
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

describe('duplicate role', () => {
  it('opens "New role" with the name and permissions of the original', async () => {
    const user = userEvent.setup();
    const api = setup(
      { 'POST /roles': jsonResponse({ ...CUSTOM, id: NEW_ID, name: 'Soporte (copia)' }, 201) },
      EDITOR,
    );
    const { router } = renderApp('/roles');
    const page = await openEditor(user, 'Soporte');
    await user.click(
      within(page).getByRole('link', { name: new RegExp(es.roles['options.duplicate']) }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Soporte (copia)' });
    expect(router.state.location.pathname).toBe('/roles/new');
    expect(field(es.roles['create.name'])).toHaveValue('Soporte (copia)');
    const fresh = screen.getByRole('main');
    for (const permission of CUSTOM.permissions) {
      expect(within(fresh).getByRole('checkbox', { name: label(permission) })).toBeChecked();
    }
    await user.click(within(fresh).getByRole('button', { name: es.roles['create.submit'] }));
    await waitFor(() => {
      expect(api.callsTo('POST', '/roles')[0]?.body).toEqual({
        name: 'Soporte (copia)',
        permissions: CUSTOM.permissions,
      });
    });
  });

  it('leaves out the permissions the user does not have, and says so', async () => {
    setup();
    renderApp(`/roles/new?from=${CUSTOM_ID}`);
    // MINE no incluye `credential.use_totp`: no se ofrece ni se copia.
    expect(
      await screen.findByText(fill(es.roles['editor.copyDropped_one'], { count: 1 })),
    ).toBeVisible();
    const page = screen.getByRole('main');
    expect(within(page).getByRole('checkbox', { name: label('user.invite') })).toBeChecked();
    expect(within(page).getByRole('checkbox', { name: label('audit.read_scope') })).toBeChecked();
    expect(within(page).queryByRole('checkbox', { name: label('credential.use_totp') })).toBeNull();
  });
});

describe('archive role', () => {
  it('shows system templates read-only, without Save or Archive', async () => {
    const user = userEvent.setup();
    setup();
    const { container } = renderApp('/roles');
    const page = await openEditor(user, 'Administrador base');
    expect(within(page).getByText(es.roles['detail.systemNote'])).toBeVisible();
    expect(within(page).queryByRole('button', { name: archiveOption })).toBeNull();
    expect(within(page).queryByRole('button', { name: es.roles['edit.submit'] })).toBeNull();
    for (const box of within(page).getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(field(es.roles['create.name'])).toHaveAttribute('readonly');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('asks for confirmation, archives only that role and returns to the refetched list', async () => {
    const user = userEvent.setup();
    let archived = false;
    const api = setup({
      'GET /roles': () =>
        jsonResponse({
          data: archived ? [SYSTEM] : [SYSTEM, CUSTOM],
          page: { nextCursor: null, limit: 25 },
        }),
      [`POST /roles/${CUSTOM_ID}/archive`]: () => {
        archived = true;
        return noContent();
      },
    });
    const { router } = renderApp('/roles');
    const dialog = await openArchive(user);
    expect(await axeViolations(dialog)).toEqual([]);
    expect(api.callsTo('POST', `/roles/${CUSTOM_ID}/archive`)).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: es.roles['archive.confirm'] }));

    expect(
      await screen.findByText(fill(es.roles['archive.toast'], { name: 'Soporte' })),
    ).toBeInTheDocument();
    expect(
      api.callsTo('POST', `/roles/${CUSTOM_ID}/archive`)[0]?.headers.get('Idempotency-Key'),
    ).toBeTruthy();
    await screen.findByRole('link', { name: cardLabel('Administrador base') });
    expect(router.state.location.pathname).toBe('/roles');
    expect(screen.queryByRole('link', { name: cardLabel('Soporte') })).toBeNull();
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /roles/${CUSTOM_ID}/archive`]: noContent() });
    renderApp('/roles');
    const dialog = await openArchive(user);
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
    const dialog = await openArchive(user);
    await user.click(within(dialog).getByRole('button', { name: es.roles['archive.confirm'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['ROLE.SYSTEM_PROTECTED'],
    );
  });

  it('shows the wait time on a 429 and does not resend while it runs', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`POST /roles/${CUSTOM_ID}/archive`]: problem(429, 'RATE_LIMITED', {
        headers: { 'Retry-After': '30' },
      }),
    });
    renderApp('/roles');
    const dialog = await openArchive(user);
    await user.click(within(dialog).getByRole('button', { name: es.roles['archive.confirm'] }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.RATE_LIMITED);
    expect(alert).not.toHaveTextContent(fill(es.errors.retryIn, { seconds: 30 }));
    expect(within(dialog).getByRole('timer')).toHaveTextContent(
      fill(es.errors.retryIn, { seconds: 30 }),
    );

    await user.click(within(dialog).getByRole('button', { name: es.roles['archive.confirm'] }));
    expect(api.callsTo('POST', `/roles/${CUSTOM_ID}/archive`)).toHaveLength(1);
  });

  it('treats a 404 (already gone) as archived and refreshes', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /roles/${CUSTOM_ID}/archive`]: problem(404, 'NOT_FOUND') });
    renderApp('/roles');
    await rowsLoaded();
    const dialog = await openArchive(user);
    const before = rolesCalls(api).length;
    await user.click(within(dialog).getByRole('button', { name: es.roles['archive.confirm'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(rolesCalls(api).length).toBeGreaterThan(before);
    });
  });
});

describe('edit role', () => {
  it('opens with the current name and permissions and sends the full replacement', async () => {
    const user = userEvent.setup();
    let updated = false;
    const api = setup(
      {
        'GET /roles': () =>
          jsonResponse({
            data: [SYSTEM, updated ? { ...CUSTOM, name: 'Soporte N2' } : CUSTOM],
            page: { nextCursor: null, limit: 25 },
          }),
        [`PATCH /roles/${CUSTOM_ID}`]: () => {
          updated = true;
          return jsonResponse({ ...CUSTOM, name: 'Soporte N2', permissions: ['user.invite'] });
        },
      },
      EDITOR,
    );
    const { router } = renderApp('/roles');
    const page = await openEditor(user, 'Soporte');
    expect(field(es.roles['create.name'])).toHaveValue('Soporte');
    expect(within(page).getByRole('checkbox', { name: label('user.update') })).not.toBeChecked();

    await user.clear(field(es.roles['create.name']));
    await user.type(field(es.roles['create.name']), 'Soporte N2');
    await user.click(within(page).getByRole('checkbox', { name: label('audit.read_scope') }));
    await user.click(within(page).getByRole('checkbox', { name: label('credential.use_totp') }));
    await user.click(within(page).getByRole('button', { name: es.roles['edit.submit'] }));

    expect(
      await screen.findByText(fill(es.roles['edit.toast'], { name: 'Soporte N2' })),
    ).toBeInTheDocument();
    const call = api.callsTo('PATCH', `/roles/${CUSTOM_ID}`)[0];
    expect(call?.body).toEqual({ name: 'Soporte N2', permissions: ['user.invite'] });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(await screen.findByRole('link', { name: cardLabel('Soporte N2') })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/roles');
  });

  it('cancelling sends nothing and returns to the list', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH /roles/${CUSTOM_ID}`]: jsonResponse(CUSTOM) }, EDITOR);
    const { router } = renderApp('/roles');
    const page = await openEditor(user, 'Soporte');
    await user.click(within(page).getByRole('link', { name: es.common['actions.cancel'] }));
    await rowsLoaded();
    expect(router.state.location.pathname).toBe('/roles');
    expect(api.callsTo('PATCH', `/roles/${CUSTOM_ID}`)).toHaveLength(0);
  });

  it('requires at least one permission and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`PATCH /roles/${CUSTOM_ID}`]: jsonResponse(CUSTOM) }, EDITOR);
    renderApp('/roles');
    const page = await openEditor(user, 'Soporte');
    for (const permission of CUSTOM.permissions) {
      await user.click(within(page).getByRole('checkbox', { name: label(permission) }));
    }
    await user.click(within(page).getByRole('button', { name: es.roles['edit.submit'] }));
    const alerts = await within(page).findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toContain(es.roles['create.permissionsRequired']);
    expect(api.callsTo('PATCH', `/roles/${CUSTOM_ID}`)).toHaveLength(0);
  });

  it('shows ROLE.NAME_TAKEN on the name field and stays on the page', async () => {
    const user = userEvent.setup();
    setup({ [`PATCH /roles/${CUSTOM_ID}`]: problem(409, 'ROLE.NAME_TAKEN') }, EDITOR);
    const { router } = renderApp('/roles');
    const page = await openEditor(user, 'Soporte');
    await user.click(within(page).getByRole('button', { name: es.roles['edit.submit'] }));
    await waitFor(() => {
      expect(field(es.roles['create.name'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(page).getByText(es.errors['ROLE.NAME_TAKEN'])).toBeVisible();
    expect(router.state.location.pathname).toBe(`/roles/${CUSTOM_ID}`);
  });

  it('shows AUTHZ.ROLE_ESCALATION from the server on the page', async () => {
    const user = userEvent.setup();
    setup({ [`PATCH /roles/${CUSTOM_ID}`]: problem(403, 'AUTHZ.ROLE_ESCALATION') }, EDITOR);
    renderApp('/roles');
    const page = await openEditor(user, 'Soporte');
    await user.click(within(page).getByRole('button', { name: es.roles['edit.submit'] }));
    expect(await within(page).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.ROLE_ESCALATION'],
    );
  });

  it('disables the submit button during a 429 and shows the wait time', async () => {
    const user = userEvent.setup();
    setup(
      {
        [`PATCH /roles/${CUSTOM_ID}`]: problem(429, 'RATE_LIMITED', {
          headers: { 'Retry-After': '30' },
        }),
      },
      EDITOR,
    );
    renderApp('/roles');
    const page = await openEditor(user, 'Soporte');
    await user.click(within(page).getByRole('button', { name: es.roles['edit.submit'] }));
    const alert = await within(page).findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.RATE_LIMITED);
    expect(alert).not.toHaveTextContent(fill(es.errors.retryIn, { seconds: 30 }));
    expect(within(page).getByRole('timer')).toHaveTextContent(
      fill(es.errors.retryIn, { seconds: 30 }),
    );
    expect(within(page).getByRole('button', { name: es.roles['edit.submit'] })).toBeDisabled();
  });

  it('shows the role read-only and explains why when it has permissions the editor lacks', async () => {
    const user = userEvent.setup();
    // MINE no incluye `credential.use_totp`, que `Soporte` sí tiene.
    const api = setup({ [`PATCH /roles/${CUSTOM_ID}`]: jsonResponse(CUSTOM) });
    const { container } = renderApp('/roles');
    const page = await openEditor(user, 'Soporte');
    expect(within(page).getByText(es.roles['edit.missingPermissions'])).toBeVisible();
    expect(within(page).queryByRole('button', { name: es.roles['edit.submit'] })).toBeNull();
    for (const box of within(page).getAllByRole('checkbox')) expect(box).toBeDisabled();
    // Se ven los permisos del rol, también el que quien edita no tiene.
    expect(
      within(page).getByRole('checkbox', { name: label('credential.use_totp') }),
    ).toBeChecked();
    expect(api.callsTo('PATCH', `/roles/${CUSTOM_ID}`)).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('system template names', () => {
  it('shows the system templates with the rank name of the active language, never a custom role', async () => {
    const LEADER: Role = { ...SYSTEM, id: NEW_ID, name: 'Leader' };
    // Un rol personalizado que se llame igual no es una plantilla: se muestra tal cual.
    const CUSTOM_LEADER: Role = { ...CUSTOM, name: 'Leader' };
    setup({
      'GET /roles': jsonResponse({
        data: [LEADER, CUSTOM_LEADER],
        page: { nextCursor: null, limit: 25 },
      }),
    });
    renderApp('/roles');
    expect(await screen.findByRole('link', { name: cardLabel(es.common['rank.2']) })).toBeVisible();
    expect(screen.getByRole('link', { name: cardLabel('Leader') })).toBeVisible();
  });

  it('shows the translated template name in the read-only editor too', async () => {
    const user = userEvent.setup();
    setup({
      'GET /roles': jsonResponse({
        data: [{ ...SYSTEM, id: NEW_ID, name: 'Leader' }, CUSTOM],
        page: { nextCursor: null, limit: 25 },
      }),
    });
    renderApp('/roles');
    await openEditor(user, es.common['rank.2']);
    expect(field(es.roles['create.name'])).toHaveValue(es.common['rank.2']);
  });
});

describe('roles screen in English', () => {
  it('renders the list and the editor in English too', async () => {
    const { loadRolesCatalog } = await import('@iam/i18n');
    const en = (await loadRolesCatalog())['en-US'];
    const user = userEvent.setup();
    setup({}, EDITOR);
    renderApp('/roles', 'en-US');
    expect(await screen.findByRole('list', { name: en.caption })).toBeInTheDocument();
    expect(screen.getByText(en['kind.system'])).toBeInTheDocument();
    await user.click(
      screen.getByRole('link', { name: en['card.openLabel'].replace('{{name}}', 'Soporte') }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Soporte' });
    expect(screen.getByRole('link', { name: en['editor.back'] })).toBeVisible();
    expect(screen.getByRole('button', { name: en['edit.submit'] })).toBeVisible();
    expect(screen.getByRole('heading', { name: en['options.title'] })).toBeVisible();
  });
});
