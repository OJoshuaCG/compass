import type { ManagedUser, Permission, PermissionCatalogEntry, Role } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const LUIS_ID = '11111111-1111-4111-8111-111111111111';
const SYSTEM_ID = '66666666-6666-4666-8666-666666666666';
const SUPPORT_ID = '77777777-7777-4777-8777-777777777777';
const AUDIT_ID = '88888888-8888-4888-8888-888888888888';

const LUIS: ManagedUser = {
  id: LUIS_ID,
  displayName: 'Luis Gómez',
  email: 'luis@example.com',
  rank: 3,
  status: 'active',
  managedBy: null,
};

const SYSTEM_ROLE: Role = {
  id: SYSTEM_ID,
  name: 'Plantilla operador',
  isSystem: true,
  permissions: ['user.invite'],
};
const SUPPORT_ROLE: Role = {
  id: SUPPORT_ID,
  name: 'Soporte',
  isSystem: false,
  permissions: ['user.invite'],
};
const AUDIT_ROLE: Role = {
  id: AUDIT_ID,
  name: 'Auditoría',
  isSystem: false,
  permissions: ['audit.read_scope'],
};

const CATALOG: PermissionCatalogEntry[] = [
  { permission: 'user.invite', maxRank: 3 },
  { permission: 'credential.use_totp', maxRank: 3 },
  { permission: 'role.manage', maxRank: 1 },
];

const label = (permission: string) =>
  (es.roles as Record<string, string>)[`permission.${permission}`] ?? permission;
const ME_PERMISSIONS: Permission[] = ['role.assign', 'user.invite'];

type Routes = Record<string, Parameters<typeof stubApi>[0][string]>;

function setup(routes: Routes = {}, permissions: Permission[] = ME_PERMISSIONS) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    'GET /users': jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    'GET /users/managed': jsonResponse({ data: [LUIS], page: { nextCursor: null, limit: 25 } }),
    'GET /roles': jsonResponse({
      data: [SYSTEM_ROLE, SUPPORT_ROLE, AUDIT_ROLE],
      page: { nextCursor: null, limit: 25 },
    }),
    'GET /permissions': jsonResponse({ data: CATALOG }),
    [`GET /users/${LUIS_ID}/roles`]: jsonResponse({
      roles: [SUPPORT_ROLE],
      specialPermissions: ['credential.use_totp'],
    }),
    ...routes,
  });
}

type User = ReturnType<typeof userEvent.setup>;

async function openDialog(user: User) {
  const menuLabel = es.directory['team.rowMenu'].replace('{{name}}', 'Luis Gómez');
  const button = await waitFor(() => {
    const candidate = screen.getByRole('button', { name: menuLabel });
    expect(candidate).toBeEnabled();
    return candidate;
  });
  await user.click(button);
  await user.click(
    await screen.findByRole('menuitem', { name: es.directory['team.action.rolesAndPermissions'] }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: es.directory['access.title'].replace('{{name}}', 'Luis Gómez'),
  });
  // El formulario aparece cuando terminan las tres consultas.
  await within(dialog).findByRole('checkbox', { name: 'Soporte' });
  return dialog;
}

describe('person roles and permissions action', () => {
  it('is offered with role.assign and hidden without it', async () => {
    const user = userEvent.setup();
    setup({}, ['user.transfer']);
    renderApp('/users?view=team');
    const menuLabel = es.directory['team.rowMenu'].replace('{{name}}', 'Luis Gómez');
    await user.click(
      await waitFor(() => {
        const candidate = screen.getByRole('button', { name: menuLabel });
        expect(candidate).toBeEnabled();
        return candidate;
      }),
    );
    // Otra acción sí aparece, así que el menú ya cargó y la ausencia es por el permiso.
    await screen.findByRole('menuitem', { name: es.directory['team.action.transfer'] });
    expect(
      screen.queryByRole('menuitem', { name: es.directory['team.action.rolesAndPermissions'] }),
    ).toBeNull();
  });
});

describe('person roles and permissions action without user.invite', () => {
  it('is hidden with role.assign alone, because the dialog reads need user.invite', async () => {
    const user = userEvent.setup();
    setup({}, ['role.assign', 'user.transfer']);
    renderApp('/users?view=team');
    const menuLabel = es.directory['team.rowMenu'].replace('{{name}}', 'Luis Gómez');
    await user.click(
      await waitFor(() => {
        const candidate = screen.getByRole('button', { name: menuLabel });
        expect(candidate).toBeEnabled();
        return candidate;
      }),
    );
    await screen.findByRole('menuitem', { name: es.directory['team.action.transfer'] });
    expect(
      screen.queryByRole('menuitem', { name: es.directory['team.action.rolesAndPermissions'] }),
    ).toBeNull();
  });
});

describe('person roles and permissions dialog', () => {
  it('loads the roles (system included) and special permissions the person has, without violations', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/users?view=team');
    const dialog = await openDialog(user);

    expect(within(dialog).getByRole('checkbox', { name: 'Soporte' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Auditoría' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Plantilla operador' })).not.toBeChecked();

    expect(
      within(dialog).getByRole('checkbox', { name: label('credential.use_totp') }),
    ).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: label('user.invite') })).not.toBeChecked();
    // El catálogo dice que `role.manage` no llega a un Operador: no se ofrece.
    expect(within(dialog).queryByRole('checkbox', { name: label('role.manage') })).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('saves the chosen roles with the roleIds body and refreshes the person', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`POST /users/${LUIS_ID}/roles`]: () =>
        jsonResponse({ roles: [SUPPORT_ROLE, AUDIT_ROLE], specialPermissions: [] }),
    });
    renderApp('/users?view=team');
    const dialog = await openDialog(user);
    const before = api.callsTo('GET', `/users/${LUIS_ID}/roles`).length;

    await user.click(within(dialog).getByRole('checkbox', { name: 'Auditoría' }));
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['access.roles.submit'] }),
    );

    expect(
      await screen.findByText(es.directory['access.roles.toast'].replace('{{name}}', 'Luis Gómez')),
    ).toBeInTheDocument();
    const posts = api.callsTo('POST', `/users/${LUIS_ID}/roles`);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ roleIds: [SUPPORT_ID, AUDIT_ID] });
    expect(api.callsTo('POST', `/users/${LUIS_ID}/special-permissions`)).toHaveLength(0);
    await waitFor(() => {
      expect(api.callsTo('GET', `/users/${LUIS_ID}/roles`).length).toBeGreaterThan(before);
    });
  });

  it('saves the special permissions with the permissions body, and an empty list removes them all', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`POST /users/${LUIS_ID}/special-permissions`]: () =>
        jsonResponse({ roles: [SUPPORT_ROLE], specialPermissions: [] }),
    });
    renderApp('/users?view=team');
    const dialog = await openDialog(user);
    const submit = es.directory['access.special.submit'];

    await user.click(within(dialog).getByRole('checkbox', { name: label('user.invite') }));
    await user.click(within(dialog).getByRole('button', { name: submit }));
    await waitFor(() => {
      expect(api.callsTo('POST', `/users/${LUIS_ID}/special-permissions`)).toHaveLength(1);
    });

    await user.click(within(dialog).getByRole('checkbox', { name: label('user.invite') }));
    await user.click(within(dialog).getByRole('checkbox', { name: label('credential.use_totp') }));
    await user.click(within(dialog).getByRole('button', { name: submit }));
    await waitFor(() => {
      expect(api.callsTo('POST', `/users/${LUIS_ID}/special-permissions`)).toHaveLength(2);
    });
    const posts = api.callsTo('POST', `/users/${LUIS_ID}/special-permissions`);
    expect(posts[0]?.body).toEqual({ permissions: ['credential.use_totp', 'user.invite'] });
    expect(posts[1]?.body).toEqual({ permissions: [] });
    expect(api.callsTo('POST', `/users/${LUIS_ID}/roles`)).toHaveLength(0);
  });

  it('keeps the dialog open and shows the translated server error', async () => {
    const user = userEvent.setup();
    setup({ [`POST /users/${LUIS_ID}/roles`]: problem(403, 'AUTHZ.ROLE_ESCALATION') });
    renderApp('/users?view=team');
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole('checkbox', { name: 'Auditoría' }));
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['access.roles.submit'] }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.ROLE_ESCALATION'],
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Lo que la persona eligió se conserva para corregirlo.
    expect(within(dialog).getByRole('checkbox', { name: 'Auditoría' })).toBeChecked();
  });

  it('reauthenticates and retries the special permissions save once', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = setup({
      [`POST /users/${LUIS_ID}/special-permissions`]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(403, 'AUTHZ.REAUTH_REQUIRED')
          : jsonResponse({ roles: [SUPPORT_ROLE], specialPermissions: [] });
      },
      'POST /auth/reauth': noContent(),
    });
    renderApp('/users?view=team');
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole('checkbox', { name: label('credential.use_totp') }));
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['access.special.submit'] }),
    );
    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(reauth).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '246810',
    );
    await user.click(within(reauth).getByRole('button', { name: es.common['reauth.submit'] }));

    expect(
      await screen.findByText(
        es.directory['access.special.toast'].replace('{{name}}', 'Luis Gómez'),
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `/users/${LUIS_ID}/special-permissions`)).toHaveLength(2);
  });

  it('keeps each save button disabled until its block differs from what is saved, and again after saving', async () => {
    const user = userEvent.setup();
    setup({
      [`POST /users/${LUIS_ID}/roles`]: () =>
        jsonResponse({
          roles: [SUPPORT_ROLE, AUDIT_ROLE],
          specialPermissions: ['credential.use_totp'],
        }),
    });
    renderApp('/users?view=team');
    const dialog = await openDialog(user);
    const rolesSubmit = within(dialog).getByRole('button', {
      name: es.directory['access.roles.submit'],
    });
    const specialSubmit = within(dialog).getByRole('button', {
      name: es.directory['access.special.submit'],
    });
    expect(rolesSubmit).toBeDisabled();
    expect(specialSubmit).toBeDisabled();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Auditoría' }));
    expect(rolesSubmit).toBeEnabled();
    // El otro bloque no cambió: su botón sigue deshabilitado.
    expect(specialSubmit).toBeDisabled();

    // Volver al estado guardado, aunque sea en otro orden, vuelve a deshabilitar (comparación como conjuntos).
    await user.click(within(dialog).getByRole('checkbox', { name: 'Auditoría' }));
    expect(rolesSubmit).toBeDisabled();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Auditoría' }));
    await user.click(rolesSubmit);
    expect(
      await screen.findByText(es.directory['access.roles.toast'].replace('{{name}}', 'Luis Gómez')),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(rolesSubmit).toBeDisabled();
    });
  });

  it('shows "unsaved changes" only on the block that differs from what is saved', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/users?view=team');
    const dialog = await openDialog(user);
    const unsaved = es.directory['access.unsaved'];
    expect(within(dialog).queryByText(unsaved)).toBeNull();

    await user.click(within(dialog).getByRole('checkbox', { name: label('user.invite') }));
    const notice = within(dialog).getByText(unsaved);
    expect(notice).toHaveAttribute('role', 'status');
    expect(within(dialog).getAllByText(unsaved)).toHaveLength(1);

    await user.click(within(dialog).getByRole('checkbox', { name: label('user.invite') }));
    expect(within(dialog).queryByText(unsaved)).toBeNull();
  });

  it('does not offer a permission the editor lacks, but keeps one already assigned to the person', async () => {
    const user = userEvent.setup();
    // `credential.use_totp` ya está asignado a Luis y el editor no lo tiene; `audit.read_scope` lo
    // admite el rango de Luis pero tampoco lo tiene el editor.
    setup({
      'GET /permissions': jsonResponse({
        data: [...CATALOG, { permission: 'audit.read_scope', maxRank: 3 }],
      }),
    });
    renderApp('/users?view=team');
    const dialog = await openDialog(user);

    expect(
      within(dialog).getByRole('checkbox', { name: label('credential.use_totp') }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole('checkbox', { name: label('user.invite') }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: label('audit.read_scope') })).toBeNull();
    expect(within(dialog).getByText(es.directory['access.special.helpLimits'])).toBeInTheDocument();
  });

  it('warns that the server will validate when the rank catalog cannot be read', async () => {
    const user = userEvent.setup();
    setup({ 'GET /permissions': problem(403, 'AUTHZ.ROLE_ESCALATION') });
    renderApp('/users?view=team');
    const dialog = await openDialog(user);

    expect(
      within(dialog).getByText(es.directory['access.special.catalogError']),
    ).toBeInTheDocument();
  });

  it('closes from the footer button', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/users?view=team');
    const dialog = await openDialog(user);

    const closeButtons = within(dialog).getAllByRole('button', { name: es.common['dialog.close'] });
    await user.click(closeButtons[closeButtons.length - 1] as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('shows an error with Retry when the person roles cannot be loaded', async () => {
    const user = userEvent.setup();
    let fail = true;
    setup({
      [`GET /users/${LUIS_ID}/roles`]: () =>
        fail ? problem(500, 'INTERNAL') : jsonResponse({ roles: [], specialPermissions: [] }),
    });
    renderApp('/users?view=team');
    const menuLabel = es.directory['team.rowMenu'].replace('{{name}}', 'Luis Gómez');
    await user.click(
      await waitFor(() => {
        const candidate = screen.getByRole('button', { name: menuLabel });
        expect(candidate).toBeEnabled();
        return candidate;
      }),
    );
    await user.click(
      await screen.findByRole('menuitem', {
        name: es.directory['team.action.rolesAndPermissions'],
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.INTERNAL);
    fail = false;
    await user.click(within(alert).getByRole('button', { name: es.common['actions.retry'] }));
    expect(await within(dialog).findByRole('checkbox', { name: 'Soporte' })).not.toBeChecked();
  });
});
