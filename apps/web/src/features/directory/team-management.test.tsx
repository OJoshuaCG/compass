import type { ManagedUser, Permission } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const LUIS_ID = '11111111-1111-4111-8111-111111111111';
const MARTA_ID = '22222222-2222-4222-8222-222222222222';
const ROOT_ID = '33333333-3333-4333-8333-333333333333';
const ANA_ID = '44444444-4444-4444-8444-444444444444';

const MANAGED: ManagedUser[] = [
  {
    id: ROOT_ID,
    displayName: 'Raíz Principal',
    email: 'root@example.com',
    rank: 0,
    status: 'active',
    managedBy: null,
  },
  {
    id: LUIS_ID,
    displayName: 'Luis Gómez',
    email: 'luis@example.com',
    rank: 3,
    status: 'active',
    managedBy: null,
  },
  {
    id: MARTA_ID,
    displayName: 'Marta Ruiz',
    email: 'marta@example.com',
    rank: 3,
    status: 'suspended',
    managedBy: null,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    displayName: 'Baja Previa',
    email: 'baja@example.com',
    rank: 3,
    status: 'deactivated',
    managedBy: null,
  },
];

const ALL: Permission[] = ['user.deactivate', 'user.update', 'user.change_rank', 'user.transfer'];
const TEAM_URL = '/users?view=team';

type Setup = { permissions?: Permission[]; rank?: 0 | 1 | 2 | 3 };

function teamApi(
  routes: Record<string, Parameters<typeof stubApi>[0][string]> = {},
  me: Setup = {},
) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: ALL, ...me })),
    'GET /users': jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    'GET /users/managed': () =>
      jsonResponse({ data: MANAGED, page: { nextCursor: null, limit: 25 } }),
    ...routes,
  });
}

type User = ReturnType<typeof userEvent.setup>;

/**
 * Botón del menú de una fila. El menú se descarga de forma diferida: antes llega un botón
 * deshabilitado con el mismo nombre (y es OTRO nodo), así que se vuelve a buscar hasta que el
 * botón real esté habilitado.
 */
function readyMenuButton(name: string) {
  const label = es.directory['team.rowMenu'].replace('{{name}}', name);
  return waitFor(() => {
    const button = screen.getByRole('button', { name: label });
    expect(button).toBeEnabled();
    return button;
  });
}

async function openMenu(user: User, name: string) {
  await user.click(await readyMenuButton(name));
}

async function chooseAction(user: User, name: string, action: keyof typeof es.directory) {
  await openMenu(user, name);
  await user.click(await screen.findByRole('menuitem', { name: es.directory[action] }));
}

const managedCalls = (api: ReturnType<typeof teamApi>) => api.callsTo('GET', '/users/managed');

describe('team management tab visibility', () => {
  it.each(ALL)('appears with %s alone', async (permission) => {
    teamApi({}, { permissions: [permission] });
    renderApp('/users');
    expect(
      await screen.findByRole('tab', { name: es.directory['users.tabs.team'] }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: es.directory['users.tabs.directory'] })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('is hidden without any management permission, even with ?view=team in the URL', async () => {
    const api = teamApi({}, { permissions: ['user.invite', 'vault.inventory.read'] });
    renderApp(TEAM_URL);
    await screen.findByRole('table', { name: es.directory['users.caption'] });
    // Con `user.invite` sí hay pestañas (Directorio e Invitaciones), pero no la de gestión.
    expect(screen.queryByRole('tab', { name: es.directory['users.tabs.team'] })).toBeNull();
    expect(screen.queryByRole('table', { name: es.directory['team.caption'] })).toBeNull();
    expect(managedCalls(api)).toHaveLength(0);
  });

  it('switches sections from the tab, keeps the view in the URL and resets search and sort', async () => {
    const user = userEvent.setup();
    const api = teamApi();
    const { router } = renderApp('/users?sort=email&dir=desc&q=ana&limit=50');
    await user.click(await screen.findByRole('tab', { name: es.directory['users.tabs.team'] }));
    await screen.findByRole('table', { name: es.directory['team.caption'] });
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ view: 'team', limit: 50 });
    });
    expect(router.state.location.search).not.toHaveProperty('q');
    expect(router.state.location.search).not.toHaveProperty('sort');
    await waitFor(() => {
      expect(managedCalls(api).length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole('tab', { name: es.directory['users.tabs.directory'] }));
    await screen.findByRole('table', { name: es.directory['users.caption'] });
    expect(router.state.location.search).not.toHaveProperty('view');
  });
});

describe('team management table', () => {
  it('renders name, email, rank and a status badge with text, with no accessibility violations', async () => {
    teamApi();
    const { container } = renderApp(TEAM_URL);
    const table = await screen.findByRole('table', { name: es.directory['team.caption'] });
    expect(await within(table).findByRole('cell', { name: 'Luis Gómez' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'marta@example.com' })).toBeInTheDocument();
    for (const status of ['active', 'suspended', 'deactivated'] as const) {
      expect(
        within(table).getAllByText(es.directory[`team.status.${status}`]).length,
      ).toBeGreaterThan(0);
    }
    expect(await axeViolations(container)).toEqual([]);
  });

  it('sends sort, limit and q from the URL to /users/managed and writes sort changes back', async () => {
    const user = userEvent.setup();
    const api = teamApi();
    const { router } = renderApp(`${TEAM_URL}&sort=rank&dir=desc&limit=50&q=lu`);
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    expect(Object.fromEntries(managedCalls(api).at(-1)?.search ?? [])).toEqual({
      sort: 'rank',
      dir: 'desc',
      limit: '50',
      q: 'lu',
    });
    const table = screen.getByRole('table');
    await user.click(within(table).getByRole('button', { name: es.directory['users.col.email'] }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ view: 'team', sort: 'email' });
    });
    await waitFor(() => {
      expect(managedCalls(api).at(-1)?.search.get('sort')).toBe('email');
    });
  });

  it('shows the translated error with retry when the list fails', async () => {
    const user = userEvent.setup();
    let fail = true;
    teamApi({
      'GET /users/managed': () =>
        fail
          ? problem(403, 'AUTHZ.PERMISSION')
          : jsonResponse({ data: MANAGED, page: { nextCursor: null, limit: 25 } }),
    });
    renderApp(TEAM_URL);
    expect(await screen.findByText(new RegExp(es.errors['AUTHZ.PERMISSION']))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: es.common['actions.retry'] }));
    expect(await screen.findByRole('cell', { name: 'Luis Gómez' })).toBeInTheDocument();
  });
});

describe('row actions menu', () => {
  it('has no menu for Root nor for deactivated people', async () => {
    teamApi();
    renderApp(TEAM_URL);
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    const rowMenu = (name: string) =>
      screen.queryByRole('button', {
        name: es.directory['team.rowMenu'].replace('{{name}}', name),
      });
    expect(rowMenu('Raíz Principal')).toBeNull();
    expect(rowMenu('Baja Previa')).toBeNull();
    expect(rowMenu('Luis Gómez')).toBeInTheDocument();
  });

  it('offers suspend for an active person and reactivate for a suspended one, and hides what lacks permission', async () => {
    const user = userEvent.setup();
    teamApi();
    const { container } = renderApp(TEAM_URL);
    await openMenu(user, 'Luis Gómez');
    // "Cerrar sesiones" depende del catálogo de descarga diferida: se espera a que aparezca.
    await waitFor(() => {
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        es.directory['team.action.suspend'],
        es.directory['team.action.changeRank'],
        es.directory['team.action.transfer'],
        es.sessions['team.action'],
        es.directory['team.action.deactivate'],
      ]);
    });
    expect(await axeViolations(screen.getByRole('menu'))).toEqual([]);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });

    await openMenu(user, 'Marta Ruiz');
    expect((await screen.findAllByRole('menuitem'))[0]).toHaveTextContent(
      es.directory['team.action.reactivate'],
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('only offers the actions the permissions allow', async () => {
    const user = userEvent.setup();
    teamApi({}, { permissions: ['user.update'] });
    renderApp(TEAM_URL);
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    // Luis está activa: con solo `user.update` no hay nada que ofrecerle (no hay menú).
    expect(
      screen.queryByRole('button', {
        name: es.directory['team.rowMenu'].replace('{{name}}', 'Luis Gómez'),
      }),
    ).toBeNull();
    await openMenu(user, 'Marta Ruiz');
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      es.directory['team.action.reactivate'],
    ]);
  });

  it('opens and runs an action with the keyboard only', async () => {
    const user = userEvent.setup();
    const api = teamApi({ [`POST /users/${LUIS_ID}/suspend`]: noContent() });
    renderApp(TEAM_URL);
    const trigger = await readyMenuButton('Luis Gómez');
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: es.directory['team.action.suspend'] });
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(api.callsTo('POST', `/users/${LUIS_ID}/suspend`)).toHaveLength(1);
    });
  });
});

describe('close sessions', () => {
  const closeUrl = `POST /users/${LUIS_ID}/sessions/revoke`;
  const choose = async (user: User, name: string) => {
    await openMenu(user, name);
    await user.click(await screen.findByRole('menuitem', { name: es.sessions['team.action'] }));
  };

  it('appears only with user.deactivate and never for Root or deactivated people', async () => {
    const user = userEvent.setup();
    teamApi({}, { permissions: ['user.deactivate'] });
    renderApp(TEAM_URL);
    await openMenu(user, 'Luis Gómez');
    expect(
      await screen.findByRole('menuitem', { name: es.sessions['team.action'] }),
    ).toBeInTheDocument();
    for (const name of ['Raíz Principal', 'Baja Previa']) {
      expect(
        screen.queryByRole('button', {
          name: es.directory['team.rowMenu'].replace('{{name}}', name),
        }),
      ).toBeNull();
    }
  });

  it('is hidden for managers without user.deactivate', async () => {
    const user = userEvent.setup();
    teamApi({}, { permissions: ['user.update', 'user.transfer'] });
    renderApp(TEAM_URL);
    await openMenu(user, 'Marta Ruiz');
    await screen.findAllByRole('menuitem');
    expect(screen.queryByRole('menuitem', { name: es.sessions['team.action'] })).toBeNull();
  });

  it('confirms first, posts without a body, reloads the table and shows a toast', async () => {
    const user = userEvent.setup();
    const api = teamApi({ [closeUrl]: noContent() });
    renderApp(TEAM_URL);
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    const before = managedCalls(api).length;
    await choose(user, 'Luis Gómez');
    const dialog = await screen.findByRole('dialog', {
      name: es.sessions['team.title'].replace('{{name}}', 'Luis Gómez'),
    });
    expect(await axeViolations(dialog)).toEqual([]);
    // Nada se ejecuta antes de confirmar.
    expect(api.callsTo('POST', `/users/${LUIS_ID}/sessions/revoke`)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: es.sessions['team.confirm'] }));
    expect(
      await screen.findByText(es.sessions['team.toast'].replace('{{name}}', 'Luis Gómez')),
    ).toBeInTheDocument();
    const call = api.callsTo('POST', `/users/${LUIS_ID}/sessions/revoke`)[0];
    expect(call?.body).toBeUndefined();
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    await waitFor(() => {
      expect(managedCalls(api).length).toBeGreaterThan(before);
    });
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const api = teamApi({ [closeUrl]: noContent() });
    renderApp(TEAM_URL);
    await choose(user, 'Luis Gómez');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('POST', `/users/${LUIS_ID}/sessions/revoke`)).toHaveLength(0);
  });

  it('shows the translated server error and keeps the dialog open', async () => {
    const user = userEvent.setup();
    teamApi({ [closeUrl]: problem(403, 'USER.ROOT_PROTECTED') });
    renderApp(TEAM_URL);
    await choose(user, 'Luis Gómez');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.sessions['team.confirm'] }));
    expect(
      await within(dialog).findByText(new RegExp(es.errors['USER.ROOT_PROTECTED'])),
    ).toBeInTheDocument();
  });
});

describe('suspend and reactivate', () => {
  it('suspend calls its endpoint, reloads the table and shows a success toast', async () => {
    const user = userEvent.setup();
    const api = teamApi({ [`POST /users/${LUIS_ID}/suspend`]: noContent() });
    renderApp(TEAM_URL);
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    const before = managedCalls(api).length;
    await chooseAction(user, 'Luis Gómez', 'team.action.suspend');
    expect(
      await screen.findByText(
        es.directory['team.toast.suspended'].replace('{{name}}', 'Luis Gómez'),
      ),
    ).toBeInTheDocument();
    const call = api.callsTo('POST', `/users/${LUIS_ID}/suspend`)[0];
    expect(call?.body).toBeUndefined();
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    await waitFor(() => {
      expect(managedCalls(api).length).toBeGreaterThan(before);
    });
  });

  it('reactivate calls its endpoint, reloads and shows a toast', async () => {
    const user = userEvent.setup();
    const api = teamApi({ [`POST /users/${MARTA_ID}/reactivate`]: noContent() });
    renderApp(TEAM_URL);
    await screen.findByRole('cell', { name: 'Marta Ruiz' });
    const before = managedCalls(api).length;
    await chooseAction(user, 'Marta Ruiz', 'team.action.reactivate');
    expect(
      await screen.findByText(
        es.directory['team.toast.reactivated'].replace('{{name}}', 'Marta Ruiz'),
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `/users/${MARTA_ID}/reactivate`)).toHaveLength(1);
    await waitFor(() => {
      expect(managedCalls(api).length).toBeGreaterThan(before);
    });
  });

  it('shows USER.INVALID_STATE translated and does not claim success', async () => {
    const user = userEvent.setup();
    teamApi({ [`POST /users/${LUIS_ID}/suspend`]: problem(409, 'USER.INVALID_STATE') });
    renderApp(TEAM_URL);
    await chooseAction(user, 'Luis Gómez', 'team.action.suspend');
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['USER.INVALID_STATE']);
    expect(screen.queryByText(/Se suspendió/)).toBeNull();
  });

  it('shows USER.ROOT_PROTECTED and AUTHZ.HIERARCHY.NOT_IN_SUBTREE translated', async () => {
    const user = userEvent.setup();
    let code = 'USER.ROOT_PROTECTED';
    teamApi({
      [`POST /users/${LUIS_ID}/suspend`]: () => problem(403, code),
    });
    renderApp(TEAM_URL);
    await chooseAction(user, 'Luis Gómez', 'team.action.suspend');
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['USER.ROOT_PROTECTED']);
    code = 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE';
    await chooseAction(user, 'Luis Gómez', 'team.action.suspend');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        es.errors['AUTHZ.HIERARCHY.NOT_IN_SUBTREE'],
      );
    });
  });
});

describe('deactivate', () => {
  it('asks for confirmation, explains the consequences and calls nothing until confirmed', async () => {
    const user = userEvent.setup();
    const api = teamApi({ [`POST /users/${LUIS_ID}/deactivate`]: noContent() });
    renderApp(TEAM_URL);
    await chooseAction(user, 'Luis Gómez', 'team.action.deactivate');
    const dialog = await screen.findByRole('dialog', {
      name: es.directory['deactivate.title'].replace('{{name}}', 'Luis Gómez'),
    });
    expect(dialog).toHaveAccessibleDescription(es.directory['deactivate.description']);
    expect(es.directory['deactivate.description']).toMatch(/irreversible/);
    expect(es.directory['deactivate.description']).toMatch(/subordinados/);
    expect(await axeViolations(dialog)).toEqual([]);
    expect(api.callsTo('POST', `/users/${LUIS_ID}/deactivate`)).toHaveLength(0);

    // Cancelar no llama a nada.
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('POST', `/users/${LUIS_ID}/deactivate`)).toHaveLength(0);

    // Confirmar sí, una vez, y recarga la tabla.
    const before = managedCalls(api).length;
    await chooseAction(user, 'Luis Gómez', 'team.action.deactivate');
    const again = await screen.findByRole('dialog');
    await user.click(
      within(again).getByRole('button', { name: es.directory['deactivate.confirm'] }),
    );
    expect(
      await screen.findByText(
        es.directory['team.toast.deactivated'].replace('{{name}}', 'Luis Gómez'),
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `/users/${LUIS_ID}/deactivate`)).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(managedCalls(api).length).toBeGreaterThan(before);
    });
  });

  it('keeps the dialog open with the translated USER.* error', async () => {
    const user = userEvent.setup();
    teamApi({ [`POST /users/${LUIS_ID}/deactivate`]: problem(409, 'USER.HAS_REPORTS') });
    renderApp(TEAM_URL);
    await chooseAction(user, 'Luis Gómez', 'team.action.deactivate');
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['deactivate.confirm'] }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['USER.HAS_REPORTS'],
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('change rank', () => {
  it('offers only ranks above the actor (higher number) and different from the current one', async () => {
    const user = userEvent.setup();
    // Administrador (1) gestionando a un Operador (3): solo queda Líder (2).
    teamApi({}, { rank: 1 });
    const first = renderApp(TEAM_URL);
    await chooseAction(user, 'Luis Gómez', 'team.action.changeRank');
    const dialog = await screen.findByRole('dialog', { name: es.directory['rank.title'] });
    const select = within(dialog).getByRole('combobox', {
      name: new RegExp(es.directory['rank.label']),
    });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([es.common['rank.2']]);
    expect(await axeViolations(dialog)).toEqual([]);
    first.unmount();
  });

  it('lets Root choose Administrador or Líder for an Operador', async () => {
    const user = userEvent.setup();
    teamApi({}, { rank: 0 });
    renderApp(TEAM_URL);
    await chooseAction(user, 'Luis Gómez', 'team.action.changeRank');
    const dialog = await screen.findByRole('dialog', { name: es.directory['rank.title'] });
    const select = within(dialog).getByRole('combobox');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([es.common['rank.1'], es.common['rank.2']]);
  });

  it('posts the chosen rank, reloads and shows a toast', async () => {
    const user = userEvent.setup();
    const api = teamApi({ [`POST /users/${LUIS_ID}/rank`]: noContent() }, { rank: 0 });
    renderApp(TEAM_URL);
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    const before = managedCalls(api).length;
    await chooseAction(user, 'Luis Gómez', 'team.action.changeRank');
    const dialog = await screen.findByRole('dialog', { name: es.directory['rank.title'] });
    await user.selectOptions(within(dialog).getByRole('combobox'), String(1));
    await user.click(within(dialog).getByRole('button', { name: es.directory['rank.submit'] }));
    expect(
      await screen.findByText(
        es.directory['team.toast.rankChanged']
          .replace('{{name}}', 'Luis Gómez')
          .replace('{{rank}}', es.common['rank.1']),
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `/users/${LUIS_ID}/rank`)[0]?.body).toEqual({ rank: 1 });
    await waitFor(() => {
      expect(managedCalls(api).length).toBeGreaterThan(before);
    });
  });

  async function submitRank(user: User) {
    await chooseAction(user, 'Luis Gómez', 'team.action.changeRank');
    const dialog = await screen.findByRole('dialog', { name: es.directory['rank.title'] });
    await user.click(within(dialog).getByRole('button', { name: es.directory['rank.submit'] }));
  }

  async function typeReauthCode(user: User) {
    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(reauth).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '246810',
    );
    await user.click(within(reauth).getByRole('button', { name: es.common['reauth.submit'] }));
  }

  it('reauthenticates and retries the rank change exactly once', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = teamApi(
      {
        [`POST /users/${LUIS_ID}/rank`]: () => {
          attempts += 1;
          return attempts === 1 ? problem(403, 'AUTHZ.REAUTH_REQUIRED') : noContent();
        },
        'POST /auth/reauth': noContent(),
      },
      { rank: 1 },
    );
    renderApp(TEAM_URL);
    await submitRank(user);
    await typeReauthCode(user);
    expect(
      await screen.findByText(
        es.directory['team.toast.rankChanged']
          .replace('{{name}}', 'Luis Gómez')
          .replace('{{rank}}', es.common['rank.2']),
      ),
    ).toBeInTheDocument();
    const rank = api.callsTo('POST', `/users/${LUIS_ID}/rank`);
    expect(rank).toHaveLength(2);
    expect(rank[1]?.body).toEqual({ rank: 2 });
    // Es la MISMA operación: misma clave de idempotencia en el reintento.
    expect(rank[1]?.headers.get('Idempotency-Key')).toBe(rank[0]?.headers.get('Idempotency-Key'));
    expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(1);
  });

  it('does not loop: a second REAUTH_REQUIRED is shown as an error', async () => {
    const user = userEvent.setup();
    const api = teamApi(
      {
        [`POST /users/${LUIS_ID}/rank`]: () => problem(403, 'AUTHZ.REAUTH_REQUIRED'),
        'POST /auth/reauth': noContent(),
      },
      { rank: 1 },
    );
    renderApp(TEAM_URL);
    await submitRank(user);
    await typeReauthCode(user);
    const dialog = await screen.findByRole('dialog', { name: es.directory['rank.title'] });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.REAUTH_REQUIRED'],
    );
    expect(api.callsTo('POST', `/users/${LUIS_ID}/rank`)).toHaveLength(2);
    expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: es.common['reauth.title'] })).toBeNull();
    });
  });

  it('shows USER.HAS_REPORTS in the dialog', async () => {
    const user = userEvent.setup();
    teamApi({ [`POST /users/${LUIS_ID}/rank`]: problem(409, 'USER.HAS_REPORTS') }, { rank: 1 });
    renderApp(TEAM_URL);
    await submitRank(user);
    const dialog = await screen.findByRole('dialog', { name: es.directory['rank.title'] });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['USER.HAS_REPORTS'],
    );
  });
});

describe('transfer manager', () => {
  const CANDIDATES = [
    { id: ROOT_ID, displayName: 'Raíz Principal', email: 'root@example.com', rank: 0 },
    { id: ANA_ID, displayName: 'Ana Pérez', email: 'ana@example.com', rank: 2 },
    // Mismo rango que la persona gestionada: no puede ser su responsable.
    { id: MARTA_ID, displayName: 'Marta Ruiz', email: 'marta@example.com', rank: 3 },
    // Es la propia persona.
    { id: LUIS_ID, displayName: 'Luis Gómez', email: 'luis@example.com', rank: 3 },
  ];

  function transferApi(extra: Parameters<typeof teamApi>[0] = {}) {
    return teamApi({
      'GET /users': ({ search }) =>
        jsonResponse({
          data: search.get('q') === 'ana' ? CANDIDATES.filter((c) => c.id === ANA_ID) : CANDIDATES,
          page: { nextCursor: null, limit: 25 },
        }),
      ...extra,
    });
  }

  it('searches the visible directory and lists only people of a higher rank', async () => {
    const user = userEvent.setup();
    const api = transferApi();
    renderApp(TEAM_URL);
    await chooseAction(user, 'Luis Gómez', 'team.action.transfer');
    const dialog = await screen.findByRole('dialog', { name: es.directory['transfer.title'] });
    const group = await within(dialog).findByRole('group', {
      name: es.directory['transfer.legend'],
    });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.closest('label')?.textContent),
    ).toEqual([expect.stringContaining('Raíz Principal'), expect.stringContaining('Ana Pérez')]);
    expect(await axeViolations(dialog)).toEqual([]);
    // El directorio se consulta ordenado por rango (los elegibles primero).
    const first = api.callsTo('GET', '/users').at(-1);
    expect(first?.search.get('sort')).toBe('rank');
    expect(first?.search.get('limit')).toBe('25');

    await user.type(
      within(dialog).getByRole('searchbox', { name: es.directory['transfer.search'] }),
      'ana',
    );
    await waitFor(() => {
      expect(api.callsTo('GET', '/users').some((c) => c.search.get('q') === 'ana')).toBe(true);
    });
    await waitFor(() => {
      expect(within(dialog).queryByText('Raíz Principal')).toBeNull();
    });
    expect(within(dialog).getByText('Ana Pérez')).toBeInTheDocument();
  });

  it('keeps the submit disabled until someone is chosen, then posts managerId, reloads and shows a toast', async () => {
    const user = userEvent.setup();
    const api = transferApi({ [`POST /users/${LUIS_ID}/manager`]: noContent() });
    renderApp(TEAM_URL);
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    const before = managedCalls(api).length;
    await chooseAction(user, 'Luis Gómez', 'team.action.transfer');
    const dialog = await screen.findByRole('dialog', { name: es.directory['transfer.title'] });
    const submit = within(dialog).getByRole('button', { name: es.directory['transfer.submit'] });
    expect(submit).toBeDisabled();
    await user.click(await within(dialog).findByRole('radio', { name: /Ana Pérez/ }));
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(
      await screen.findByText(
        es.directory['team.toast.transferred'].replace('{{name}}', 'Luis Gómez'),
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `/users/${LUIS_ID}/manager`)[0]?.body).toEqual({
      managerId: ANA_ID,
    });
    await waitFor(() => {
      expect(managedCalls(api).length).toBeGreaterThan(before);
    });
  });

  it('shows USER.MANAGER_RANK_INVALID translated and keeps the dialog', async () => {
    const user = userEvent.setup();
    transferApi({ [`POST /users/${LUIS_ID}/manager`]: problem(422, 'USER.MANAGER_RANK_INVALID') });
    renderApp(TEAM_URL);
    await chooseAction(user, 'Luis Gómez', 'team.action.transfer');
    const dialog = await screen.findByRole('dialog', { name: es.directory['transfer.title'] });
    await user.click(await within(dialog).findByRole('radio', { name: /Ana Pérez/ }));
    await user.click(within(dialog).getByRole('button', { name: es.directory['transfer.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['USER.MANAGER_RANK_INVALID'],
    );
    expect(
      screen.getByRole('dialog', { name: es.directory['transfer.title'] }),
    ).toBeInTheDocument();
  });
});

describe('English locale', () => {
  it('renders the tab, the status and the menu without literal Spanish text', async () => {
    const user = userEvent.setup();
    teamApi();
    renderApp(TEAM_URL, 'en-US');
    expect(await screen.findByRole('tab', { name: 'Team management' })).toBeInTheDocument();
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    expect(screen.getAllByText('Suspended').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Actions for Luis Gómez' }));
    expect(await screen.findByRole('menuitem', { name: 'Deactivate' })).toBeInTheDocument();
  });
});
