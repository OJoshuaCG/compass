import type { Permission } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const USERS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Luis Gómez',
    email: 'luis@example.com',
    rank: 2,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Marta Ruiz',
    email: 'marta@example.com',
    rank: 3,
  },
];

function directoryApi(options: { permissions?: Permission[]; rank?: 0 | 1 | 2 | 3 } = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture(options)),
    'GET /users': ({ search }) =>
      jsonResponse({
        data: USERS,
        page: { nextCursor: search.get('cursor') === null ? 'cursor-2' : null, limit: 25 },
      }),
  });
}

const lastUsersCall = (api: ReturnType<typeof directoryApi>) => api.callsTo('GET', '/users').at(-1);

describe('user directory', () => {
  it('renders the standard DataTable with columns, rows and no accessibility violations', async () => {
    directoryApi();
    const { container } = renderApp('/users');
    const table = await screen.findByRole('table', { name: es.directory['users.caption'] });
    expect(await within(table).findByRole('cell', { name: 'Luis Gómez' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'marta@example.com' })).toBeInTheDocument();
    // El rango se muestra con su nombre, no con el número.
    expect(within(table).getByRole('cell', { name: es.common['rank.2'] })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('applies sort, direction, limit and q from the URL to the request', async () => {
    const api = directoryApi();
    renderApp('/users?sort=email&dir=desc&limit=50&q=ana');
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    const call = lastUsersCall(api);
    expect(Object.fromEntries(call?.search ?? [])).toEqual({
      sort: 'email',
      dir: 'desc',
      limit: '50',
      q: 'ana',
    });
    expect(screen.getByRole('searchbox', { name: es.common['search.label'] })).toHaveValue('ana');
  });

  it('keeps sort and limit in the URL (server side) and the cursor out of it', async () => {
    const user = userEvent.setup();
    const api = directoryApi();
    const { router } = renderApp('/users');
    const table = await screen.findByRole('table');
    await within(table).findByRole('cell', { name: 'Luis Gómez' });

    await user.click(within(table).getByRole('button', { name: es.directory['users.col.name'] }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ sort: 'displayName', dir: 'asc' });
    });
    await waitFor(() => {
      expect(lastUsersCall(api)?.search.get('sort')).toBe('displayName');
    });
    expect(lastUsersCall(api)?.search.get('dir')).toBe('asc');

    await user.selectOptions(
      screen.getByRole('combobox', { name: es.common['table.rowsPerPage'] }),
      '50',
    );
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ limit: 50 });
    });
    await waitFor(() => {
      expect(lastUsersCall(api)?.search.get('limit')).toBe('50');
    });

    await user.click(screen.getByRole('button', { name: es.common['table.next'] }));
    await waitFor(() => {
      expect(lastUsersCall(api)?.search.get('cursor')).toBe('cursor-2');
    });
    // El cursor caduca y no es compartible: nunca va a la URL.
    expect(router.state.location.search).not.toHaveProperty('cursor');

    await user.click(screen.getByRole('button', { name: es.common['table.previous'] }));
    // La primera página sigue en caché (staleTime): volver no repite la petición.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: es.common['table.previous'] })).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: es.common['table.next'] })).toBeEnabled();
  });

  it('commits the search to the URL once the user stops typing', async () => {
    const user = userEvent.setup();
    const api = directoryApi();
    const { router } = renderApp('/users');
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    await user.type(screen.getByRole('searchbox', { name: es.common['search.label'] }), 'lu');
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ q: 'lu' });
    });
    await waitFor(() => {
      expect(lastUsersCall(api)?.search.get('q')).toBe('lu');
    });
    // Una petición por pausa, no una por tecla.
    expect(api.callsTo('GET', '/users').some((call) => call.search.get('q') === 'l')).toBe(false);
  });

  it('falls back to valid defaults when the URL carries invalid values', async () => {
    const api = directoryApi();
    renderApp('/users?sort=password&limit=7');
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    expect(lastUsersCall(api)?.search.get('sort')).toBeNull();
    expect(lastUsersCall(api)?.search.get('limit')).toBe('25');
  });

  it('shows the translated error with retry when the list fails', async () => {
    const user = userEvent.setup();
    let fail = true;
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      'GET /users': () => {
        if (fail) return problem(403, 'AUTHZ.PERMISSION');
        return jsonResponse({ data: USERS, page: { nextCursor: null, limit: 25 } });
      },
    });
    renderApp('/users');
    expect(await screen.findByText(new RegExp(es.errors['AUTHZ.PERMISSION']))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: es.common['actions.retry'] }));
    expect(await screen.findByRole('cell', { name: 'Luis Gómez' })).toBeInTheDocument();
  });
});

describe('invite permission', () => {
  it('hides the invite button without user.invite', async () => {
    directoryApi({ permissions: ['user.update'] });
    renderApp('/users');
    await screen.findByRole('cell', { name: 'Luis Gómez' });
    expect(
      screen.queryByRole('button', { name: es.directory['users.invite'] }),
    ).not.toBeInTheDocument();
  });

  it('shows the invite button with user.invite', async () => {
    directoryApi({ permissions: ['user.invite'] });
    renderApp('/users');
    expect(
      await screen.findByRole('button', { name: es.directory['users.invite'] }),
    ).toBeInTheDocument();
  });
});

describe('invite user dialog', () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: es.directory['users.invite'] }));
    return screen.findByRole('dialog', { name: es.directory['invite.title'] });
  }

  it('offers only ranks the actor can create and sends a validated request', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      'GET /me': jsonResponse(meFixture({ permissions: ['user.invite'], rank: 1 })),
      'GET /users': jsonResponse({ data: USERS, page: { nextCursor: null, limit: 25 } }),
      'POST /invitations': jsonResponse(
        {
          id: '33333333-3333-4333-8333-333333333333',
          email: 'nuevo@example.com',
          rank: 3,
          expiresAt: '2030-01-04T12:00:00.000Z',
        },
        201,
      ),
    });
    const { container } = renderApp('/users');
    const dialog = await openDialog(user);
    expect(await axeViolations(container)).toEqual([]);

    // Un Administrador (rango 1) crea Líder y Operador, no Administradores.
    const options = within(
      within(dialog).getByRole('combobox', { name: new RegExp(es.directory['invite.rank']) }),
    ).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      es.common['rank.2'],
      es.common['rank.3'],
    ]);

    await user.type(field(es.directory['invite.email']), 'Nuevo@Example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));

    expect(await screen.findByText('Invitación enviada a nuevo@example.com.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const call = api.callsTo('POST', '/invitations')[0];
    expect(call?.body).toEqual({ email: 'nuevo@example.com', rank: 3, roleIds: [] });
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
  });

  it('validates the email on the client and sends nothing', async () => {
    const user = userEvent.setup();
    const api = directoryApi({ permissions: ['user.invite'] });
    renderApp('/users');
    const dialog = await openDialog(user);
    await user.type(field(es.directory['invite.email']), 'not-an-email');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    expect(await within(dialog).findByText(es.common['validation.email'])).toBeInTheDocument();
    expect(api.callsTo('POST', '/invitations')).toHaveLength(0);
  });

  it('shows INVITATION.CONFLICT in the email field', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /me': jsonResponse(meFixture({ permissions: ['user.invite'] })),
      'GET /users': jsonResponse({ data: USERS, page: { nextCursor: null, limit: 25 } }),
      'POST /invitations': problem(409, 'INVITATION.CONFLICT'),
    });
    renderApp('/users');
    const dialog = await openDialog(user);
    const email = field(es.directory['invite.email']);
    await user.type(email, 'luis@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    await waitFor(() => {
      expect(email).toHaveAccessibleDescription(es.errors['INVITATION.CONFLICT']);
    });
  });

  it('shows hierarchy errors (403) as a translated alert and keeps the dialog open', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /me': jsonResponse(meFixture({ permissions: ['user.invite'] })),
      'GET /users': jsonResponse({ data: USERS, page: { nextCursor: null, limit: 25 } }),
      'POST /invitations': problem(403, 'AUTHZ.CREATION_NOT_ALLOWED'),
    });
    renderApp('/users');
    const dialog = await openDialog(user);
    await user.type(field(es.directory['invite.email']), 'x@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.CREATION_NOT_ALLOWED'],
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
