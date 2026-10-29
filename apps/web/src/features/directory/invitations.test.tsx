import type { ManagedUser, PendingInvitation, Permission, Role } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const PENDING_ID = '11111111-1111-4111-8111-111111111111';
const EXPIRED_ID = '22222222-2222-4222-8222-222222222222';
const NEW_ID = '33333333-3333-4333-8333-333333333333';
const ROLE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROLE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROLE_SYSTEM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const invitation = (overrides: Partial<PendingInvitation>): PendingInvitation => ({
  id: PENDING_ID,
  email: 'ana@example.com',
  rank: 3,
  createdAt: '2030-01-01T10:00:00.000Z',
  expiresAt: '2030-01-04T10:00:00.000Z',
  expired: false,
  ...overrides,
});
const PENDING = invitation({});
const EXPIRED = invitation({ id: EXPIRED_ID, email: 'luis@example.com', rank: 2, expired: true });

const role = (id: string, name: string, isSystem = false): Role => ({
  id,
  name,
  isSystem,
  permissions: ['user.invite'],
});

const listOf = (...items: PendingInvitation[]) =>
  jsonResponse({ data: items, page: { nextCursor: null, limit: 25 } });
const resendLabel = (email: string) =>
  es.directory['invitations.resendLabel'].replace('{{email}}', email);
const rowText = (text: string) => screen.findByRole('cell', { name: text });
const pendingCalls = (api: ReturnType<typeof stubApi>) => api.callsTo('GET', '/invitations');

function setup(
  extra: Record<string, Parameters<typeof stubApi>[0][string]> = {},
  permissions: Permission[] = ['user.invite'],
) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    'GET /users': jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    'GET /invitations': listOf(PENDING, EXPIRED),
    ...extra,
  });
}

describe('invitations tab', () => {
  it('lists pending invitations with rank, dates and a Pending/Expired badge, without violations', async () => {
    setup();
    const user = userEvent.setup();
    const { container, router } = renderApp('/users');
    await user.click(
      await screen.findByRole('tab', { name: es.directory['users.tabs.invitations'] }),
    );
    await rowText('ana@example.com');
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ view: 'invitations' });
    });
    const table = screen.getByRole('table', { name: es.directory['invitations.caption'] });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const first = within(rows[1] as HTMLElement);
    expect(first.getByText(es.common['rank.3'])).toBeInTheDocument();
    expect(first.getByText(es.directory['invitations.status.pending'])).toBeInTheDocument();
    // Enviada y vence: dos fechas formateadas para la zona del perfil.
    expect(first.getAllByText(/2030/)).toHaveLength(2);
    const second = within(rows[2] as HTMLElement);
    expect(second.getByText(es.directory['invitations.status.expired'])).toBeInTheDocument();
    expect(second.getByText(es.common['rank.2'])).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens straight from ?view=invitations', async () => {
    setup();
    renderApp('/users?view=invitations');
    await rowText('luis@example.com');
    expect(
      screen.getByRole('tab', { name: es.directory['users.tabs.invitations'] }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('is hidden without user.invite, even with ?view=invitations in the URL', async () => {
    const api = setup({}, ['vault.inventory.read']);
    renderApp('/users?view=invitations');
    await screen.findByRole('table', { name: es.directory['users.caption'] });
    expect(screen.queryByRole('tab', { name: es.directory['users.tabs.invitations'] })).toBeNull();
    expect(pendingCalls(api)).toHaveLength(0);
  });

  it('shows an empty state', async () => {
    setup({ 'GET /invitations': listOf() });
    renderApp('/users?view=invitations');
    expect(await screen.findByText(es.directory['invitations.empty.title'])).toBeInTheDocument();
  });

  it('shows a translated error with Retry, and retry reloads', async () => {
    const user = userEvent.setup();
    let fail = true;
    const api = setup({
      'GET /invitations': () => (fail ? problem(500, 'INTERNAL') : listOf(PENDING)),
    });
    renderApp('/users?view=invitations');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.INTERNAL);
    fail = false;
    await user.click(within(alert).getByRole('button', { name: es.common['actions.retry'] }));
    await rowText('ana@example.com');
    expect(pendingCalls(api).length).toBeGreaterThan(1);
  });

  it('resends without confirmation, shows a toast and refetches', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`POST /invitations/${PENDING_ID}/resend`]: jsonResponse(
        {
          id: PENDING_ID,
          email: 'ana@example.com',
          rank: 3,
          expiresAt: '2030-02-01T10:00:00.000Z',
        },
        201,
      ),
    });
    renderApp('/users?view=invitations');
    await rowText('ana@example.com');
    const before = pendingCalls(api).length;
    await user.click(screen.getByRole('button', { name: resendLabel('ana@example.com') }));

    expect(
      await screen.findByText(
        es.directory['invitations.resent'].replace('{{email}}', 'ana@example.com'),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    const call = api.callsTo('POST', `/invitations/${PENDING_ID}/resend`)[0];
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    await waitFor(() => {
      expect(pendingCalls(api).length).toBeGreaterThan(before);
    });
  });

  it('shows a permission error inline and does not refetch', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`POST /invitations/${PENDING_ID}/resend`]: problem(403, 'AUTHZ.PERMISSION'),
    });
    renderApp('/users?view=invitations');
    await rowText('ana@example.com');
    const before = pendingCalls(api).length;
    await user.click(screen.getByRole('button', { name: resendLabel('ana@example.com') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.PERMISSION']);
    expect(pendingCalls(api)).toHaveLength(before);
    expect(screen.queryByText(/Se reenvió/)).toBeNull();
  });

  it('shows the wait time on a 429 and does not resend while it runs', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`POST /invitations/${PENDING_ID}/resend`]: problem(429, 'RATE_LIMITED', {
        headers: { 'Retry-After': '30' },
      }),
    });
    renderApp('/users?view=invitations');
    await rowText('ana@example.com');
    await user.click(screen.getByRole('button', { name: resendLabel('ana@example.com') }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.RATE_LIMITED);
    expect(alert).not.toHaveTextContent(es.errors.retryIn.replace('{{seconds}}', '30'));
    expect(screen.getByRole('timer')).toHaveTextContent(
      es.errors.retryIn.replace('{{seconds}}', '30'),
    );

    await user.click(screen.getByRole('button', { name: resendLabel('ana@example.com') }));
    expect(api.callsTo('POST', `/invitations/${PENDING_ID}/resend`)).toHaveLength(1);
  });

  it('on INVITATION.INVALID shows the error and refreshes the list (it was accepted or revoked)', async () => {
    const user = userEvent.setup();
    let gone = false;
    const api = setup({
      'GET /invitations': () => listOf(...(gone ? [EXPIRED] : [PENDING, EXPIRED])),
      [`POST /invitations/${PENDING_ID}/resend`]: () => {
        gone = true;
        return problem(422, 'INVITATION.INVALID');
      },
    });
    renderApp('/users?view=invitations');
    await rowText('ana@example.com');
    const before = pendingCalls(api).length;
    await user.click(screen.getByRole('button', { name: resendLabel('ana@example.com') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['INVITATION.INVALID']);
    await waitFor(() => {
      expect(pendingCalls(api).length).toBeGreaterThan(before);
      expect(screen.queryByRole('cell', { name: 'ana@example.com' })).toBeNull();
    });
  });

  it('refreshes the list after sending a new invitation from the dialog', async () => {
    const user = userEvent.setup();
    let sent = false;
    const api = setup({
      'GET /invitations': () =>
        listOf(...(sent ? [invitation({ id: NEW_ID, email: 'nuevo@example.com' })] : [PENDING])),
      'POST /invitations': () => {
        sent = true;
        return jsonResponse(
          {
            id: NEW_ID,
            email: 'nuevo@example.com',
            rank: 3,
            expiresAt: '2030-01-04T12:00:00.000Z',
          },
          201,
        );
      },
    });
    renderApp('/users?view=invitations');
    await rowText('ana@example.com');
    const before = pendingCalls(api).length;
    await user.click(screen.getByRole('button', { name: es.directory['users.invite'] }));
    const dialog = await screen.findByRole('dialog', { name: es.directory['invite.title'] });
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    expect(await rowText('nuevo@example.com')).toBeInTheDocument();
    expect(pendingCalls(api).length).toBeGreaterThan(before);
  });
});

describe('invite dialog roles', () => {
  const rolesHandler = jsonResponse({
    data: [
      role(ROLE_SYSTEM, 'Plantilla del sistema', true),
      role(ROLE_A, 'Soporte'),
      role(ROLE_B, 'Auditoría externa'),
    ],
    page: { nextCursor: null, limit: 25 },
  });
  const created = () =>
    jsonResponse(
      { id: NEW_ID, email: 'nuevo@example.com', rank: 3, expiresAt: '2030-01-04T12:00:00.000Z' },
      201,
    );

  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: es.directory['users.invite'] }));
    return screen.findByRole('dialog', { name: es.directory['invite.title'] });
  }

  it('offers only custom roles as an accessible group and sends the chosen ids as roleIds', async () => {
    const user = userEvent.setup();
    const api = setup({ 'GET /roles': rolesHandler, 'POST /invitations': created });
    renderApp('/users');
    const dialog = await open(user);
    const group = await within(dialog).findByRole('group', { name: es.directory['invite.roles'] });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(group).queryByText('Plantilla del sistema')).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);

    await user.click(within(group).getByRole('checkbox', { name: 'Auditoría externa' }));
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    await waitFor(() => {
      expect(api.callsTo('POST', '/invitations')).toHaveLength(1);
    });
    expect(api.callsTo('POST', '/invitations')[0]?.body).toEqual({
      email: 'nuevo@example.com',
      rank: 3,
      roleIds: [ROLE_B],
    });
  });

  it('shows no roles section when there are only system roles, and sends roleIds: []', async () => {
    const user = userEvent.setup();
    const api = setup({
      'GET /roles': jsonResponse({
        data: [role(ROLE_SYSTEM, 'Plantilla', true)],
        page: { nextCursor: null, limit: 25 },
      }),
      'POST /invitations': created,
    });
    renderApp('/users');
    const dialog = await open(user);
    await waitFor(() => {
      expect(api.callsTo('GET', '/roles')).toHaveLength(1);
    });
    expect(within(dialog).queryByRole('group', { name: es.directory['invite.roles'] })).toBeNull();
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    await waitFor(() => {
      expect(api.callsTo('POST', '/invitations')).toHaveLength(1);
    });
    expect(api.callsTo('POST', '/invitations')[0]?.body).toMatchObject({ roleIds: [] });
  });

  it('keeps the form usable when the roles request fails', async () => {
    const user = userEvent.setup();
    setup({ 'GET /roles': problem(500, 'INTERNAL') });
    renderApp('/users');
    const dialog = await open(user);
    expect(
      await within(dialog).findByRole('button', { name: es.directory['invite.submit'] }),
    ).toBeVisible();
    expect(within(dialog).queryByRole('group', { name: es.directory['invite.roles'] })).toBeNull();
  });

  it('shows AUTHZ.ROLE_ESCALATION in the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    setup({
      'GET /roles': rolesHandler,
      'POST /invitations': problem(403, 'AUTHZ.ROLE_ESCALATION'),
    });
    renderApp('/users');
    const dialog = await open(user);
    const group = await within(dialog).findByRole('group', { name: es.directory['invite.roles'] });
    await user.click(within(group).getByRole('checkbox', { name: 'Soporte' }));
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.ROLE_ESCALATION'],
    );
  });
});

describe('invite dialog manager', () => {
  const MANAGER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const managed = (overrides: Partial<ManagedUser>): ManagedUser => ({
    id: MANAGER_ID,
    displayName: 'Beto Ruiz',
    email: 'beto@example.com',
    rank: 2,
    status: 'active',
    managedBy: null,
    ...overrides,
  });
  const managedHandler = jsonResponse({
    data: [
      managed({}),
      managed({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', displayName: 'Carla Soto', rank: 3 }),
      managed({
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        displayName: 'Dani Lara',
        status: 'suspended',
      }),
    ],
    page: { nextCursor: null, limit: 100 },
  });
  const created = () =>
    jsonResponse(
      { id: NEW_ID, email: 'nuevo@example.com', rank: 3, expiresAt: '2030-01-04T12:00:00.000Z' },
      201,
    );
  const betoLabel = `Beto Ruiz · beto@example.com · ${es.common['rank.2']}`;

  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: es.directory['users.invite'] }));
    return screen.findByRole('dialog', { name: es.directory['invite.title'] });
  }
  const submit = (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) =>
    user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));

  it('offers an optional labelled select with help, defaulting to the inviter, listing only eligible people', async () => {
    const user = userEvent.setup();
    const api = setup({ 'GET /users/managed': managedHandler });
    renderApp('/users');
    const dialog = await open(user);
    const select = await within(dialog).findByRole('combobox', {
      name: es.directory['invite.manager'],
    });
    expect(select).toHaveValue('');
    expect(select).not.toBeRequired();
    expect(select).toHaveAccessibleDescription(es.directory['invite.managerHelp']);
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    // Invitado de rango 3 por defecto: solo Beto (rango 2, activo); Carla tiene el mismo rango y
    // Dani está suspendida.
    expect(options).toEqual([es.directory['invite.managerSelf'], betoLabel]);
    expect(api.callsTo('GET', '/users/managed')[0]?.search.get('sort')).toBe('rank');
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('omits managerId when the default is kept', async () => {
    const user = userEvent.setup();
    const api = setup({ 'GET /users/managed': managedHandler, 'POST /invitations': created });
    renderApp('/users');
    const dialog = await open(user);
    await within(dialog).findByRole('combobox', { name: es.directory['invite.manager'] });
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await submit(user, dialog);
    await waitFor(() => {
      expect(api.callsTo('POST', '/invitations')).toHaveLength(1);
    });
    const body = api.callsTo('POST', '/invitations')[0]?.body;
    expect(body).toEqual({ email: 'nuevo@example.com', rank: 3, roleIds: [] });
    expect(body).not.toHaveProperty('managerId');
  });

  it('sends the chosen person as managerId, selectable by keyboard', async () => {
    const user = userEvent.setup();
    const api = setup({ 'GET /users/managed': managedHandler, 'POST /invitations': created });
    renderApp('/users');
    const dialog = await open(user);
    const select = await within(dialog).findByRole('combobox', {
      name: es.directory['invite.manager'],
    });
    await user.selectOptions(select, betoLabel);
    expect(select).toHaveValue(MANAGER_ID);
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await submit(user, dialog);
    await waitFor(() => {
      expect(api.callsTo('POST', '/invitations')).toHaveLength(1);
    });
    expect(api.callsTo('POST', '/invitations')[0]?.body).toEqual({
      email: 'nuevo@example.com',
      rank: 3,
      roleIds: [],
      managerId: MANAGER_ID,
    });
  });

  it('drops a chosen manager that stops being eligible when the invitee rank goes up', async () => {
    const user = userEvent.setup();
    const api = setup({ 'GET /users/managed': managedHandler, 'POST /invitations': created });
    renderApp('/users');
    const dialog = await open(user);
    const select = await within(dialog).findByRole('combobox', {
      name: es.directory['invite.manager'],
    });
    await user.selectOptions(select, betoLabel);
    // Rango 2: Beto ya no tiene rango superior y el campo desaparece.
    await user.selectOptions(field(es.directory['invite.rank']), es.common['rank.2']);
    await waitFor(() => {
      expect(
        within(dialog).queryByRole('combobox', { name: es.directory['invite.manager'] }),
      ).toBeNull();
    });
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await submit(user, dialog);
    await waitFor(() => {
      expect(api.callsTo('POST', '/invitations')).toHaveLength(1);
    });
    expect(api.callsTo('POST', '/invitations')[0]?.body).not.toHaveProperty('managerId');
  });

  it('hides the field when nobody is eligible and keeps the form usable when the request fails', async () => {
    const user = userEvent.setup();
    setup({ 'GET /users/managed': problem(500, 'INTERNAL') });
    renderApp('/users');
    const dialog = await open(user);
    expect(
      await within(dialog).findByRole('button', { name: es.directory['invite.submit'] }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole('combobox', { name: es.directory['invite.manager'] }),
    ).toBeNull();
  });

  it.each([
    [403, 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE'],
    [422, 'USER.MANAGER_RANK_INVALID'],
  ] as const)(
    'announces %i %s next to the field and keeps the dialog open',
    async (status, code) => {
      const user = userEvent.setup();
      setup({
        'GET /users/managed': managedHandler,
        'POST /invitations': problem(status, code),
      });
      renderApp('/users');
      const dialog = await open(user);
      const select = await within(dialog).findByRole('combobox', {
        name: es.directory['invite.manager'],
      });
      await user.selectOptions(select, betoLabel);
      await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
      await submit(user, dialog);
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(es.errors[code]);
      expect(select).toHaveAttribute('aria-invalid', 'true');
      expect(select).toHaveAccessibleDescription(expect.stringContaining(es.errors[code]));
    },
  );
});
