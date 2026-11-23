import type { DirectoryUser, Group, GroupMember, Permission } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const PAGE = '/groups';
const GROUPS_PATH = '/groups';

const GROUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const READONLY_GROUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const MANAGER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const CANDIDATE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const NEW_GROUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const OPERATOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';

const MEMBERS_PATH = `/groups/${GROUP_ID}/members`;

const groupFixture = (overrides: Partial<Group> = {}): Group => ({
  id: GROUP_ID,
  name: 'Contabilidad',
  description: 'Equipo de finanzas',
  memberCount: 2,
  myRole: 'manager',
  canManageMembers: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const MANAGED_GROUP = groupFixture();
const READONLY_GROUP = groupFixture({
  id: READONLY_GROUP_ID,
  name: 'Soporte',
  description: null,
  memberCount: 5,
  myRole: null,
  canManageMembers: false,
});

const memberFixture = (
  userId: string,
  displayName: string,
  role: GroupMember['role'],
): GroupMember => ({ userId, displayName, role, addedAt: '2026-10-02T10:00:00.000Z' });

const MANAGER = memberFixture(MANAGER_ID, 'Marta Ruiz', 'manager');
const MEMBER = memberFixture(MEMBER_ID, 'Pedro León', 'member');
const NEW_MEMBER = memberFixture(CANDIDATE_ID, 'Luis Gómez', 'member');

const CANDIDATE: DirectoryUser = {
  id: CANDIDATE_ID,
  displayName: 'Luis Gómez',
  email: 'luis@example.com',
  rank: 2,
};

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    template,
  );

type Routes = Parameters<typeof stubApi>[0];

function setup(options: { permissions?: Permission[]; extra?: Routes } = {}) {
  const { permissions = ['group.create'], extra = {} } = options;
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 2 })),
    [`GET ${GROUPS_PATH}`]: jsonResponse({ data: [MANAGED_GROUP, READONLY_GROUP] }),
    [`GET ${MEMBERS_PATH}`]: jsonResponse({ data: [MANAGER, MEMBER] }),
    'GET /users': jsonResponse({ data: [CANDIDATE], page: { nextCursor: null, limit: 25 } }),
    ...extra,
  });
}

const pageTitle = () => screen.findByRole('heading', { name: es.directory['groups.title'] });
const rowsLoaded = () => screen.findByRole('cell', { name: MANAGED_GROUP.name });

async function openCreateDialog(user: ReturnType<typeof userEvent.setup>) {
  await rowsLoaded();
  await user.click(screen.getByRole('button', { name: es.directory['groups.action.create'] }));
  return screen.findByRole('dialog', { name: es.directory['groups.create.title'] });
}

async function openMembersDialog(
  user: ReturnType<typeof userEvent.setup>,
  group: Group = MANAGED_GROUP,
) {
  await rowsLoaded();
  await user.click(
    screen.getByRole('button', {
      name: fill(es.directory['groups.members.openLabel'], { name: group.name }),
    }),
  );
  return screen.findByRole('dialog', {
    name: fill(es.directory['groups.members.title'], { name: group.name }),
  });
}

describe('groups list', () => {
  it('lists name, description, member count and the role as text, without violations', async () => {
    setup();
    const { container } = renderApp(PAGE);
    await pageTitle();

    await rowsLoaded();
    expect(screen.getByRole('cell', { name: 'Equipo de finanzas' })).toBeVisible();
    expect(screen.getByRole('cell', { name: es.directory['groups.role.manager'] })).toBeVisible();
    expect(screen.getByRole('cell', { name: es.directory['groups.noDescription'] })).toBeVisible();
    expect(screen.getByRole('cell', { name: es.directory['groups.role.none'] })).toBeVisible();
    expect(screen.getByRole('cell', { name: '5' })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('asks for every visible group, not only the managed ones', async () => {
    const api = setup();
    renderApp(PAGE);
    await rowsLoaded();

    expect(api.callsTo('GET', GROUPS_PATH)[0]?.search.get('managedByMe')).toBe('false');
  });

  it('shows an empty state when there are no groups', async () => {
    setup({ extra: { [`GET ${GROUPS_PATH}`]: jsonResponse({ data: [] }) } });
    renderApp(PAGE);
    await pageTitle();

    expect(await screen.findByText(es.directory['groups.empty.title'])).toBeVisible();
  });

  it('shows a translated error and reloads when retrying', async () => {
    const user = userEvent.setup();
    // El cliente de consultas reintenta solos los 5xx: el servidor falla hasta que la persona
    // pulsa «Reintentar», no solo en la primera llamada.
    let serverRecovered = false;
    const api = setup({
      extra: {
        [`GET ${GROUPS_PATH}`]: () =>
          serverRecovered ? jsonResponse({ data: [MANAGED_GROUP] }) : problem(500, 'INTERNAL'),
      },
    });
    renderApp(PAGE);
    await pageTitle();

    const retryButton = await screen.findByRole('button', { name: es.common['actions.retry'] });
    serverRecovered = true;
    await user.click(retryButton);

    expect(await rowsLoaded()).toBeVisible();
    expect(api.callsTo('GET', GROUPS_PATH).length).toBeGreaterThanOrEqual(2);
  });

  it('is reachable from the People section of the menu', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/');
    // En dev, Grupos es una pestaña de la sección Personas, junto a Usuarios y Roles.
    await user.click(await screen.findByRole('link', { name: es.common['nav.people'] }));
    await user.click(await screen.findByRole('link', { name: es.common['nav.groups'] }));

    expect(await pageTitle()).toBeVisible();
  });
});

describe('create group', () => {
  it('offers the button only with the group.create permission', async () => {
    setup({ permissions: [] });
    renderApp(PAGE);
    await rowsLoaded();

    expect(screen.queryByRole('button', { name: es.directory['groups.action.create'] })).toBeNull();
  });

  it('sends the name and description, shows a toast, reloads the list and closes', async () => {
    const user = userEvent.setup();
    const api = setup({
      extra: { [`POST ${GROUPS_PATH}`]: jsonResponse({ data: { id: NEW_GROUP_ID } }, 201) },
    });
    renderApp(PAGE);
    const dialog = await openCreateDialog(user);

    expect(await axeViolations(dialog)).toEqual([]);
    await user.type(field(es.directory['groups.create.name']), 'Nómina');
    await user.type(field(es.directory['groups.create.descriptionLabel']), 'Pagos quincenales');
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['groups.create.submit'] }),
    );

    expect(
      await screen.findByText(fill(es.directory['groups.create.toast'], { name: 'Nómina' })),
    ).toBeInTheDocument();
    const posts = api.callsTo('POST', GROUPS_PATH);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ name: 'Nómina', description: 'Pagos quincenales' });
    await waitFor(() => {
      expect(api.callsTo('GET', GROUPS_PATH).length).toBeGreaterThan(1);
    });
    expect(screen.queryByRole('dialog', { name: es.directory['groups.create.title'] })).toBeNull();
  });

  it('omits an empty description', async () => {
    const user = userEvent.setup();
    const api = setup({
      extra: { [`POST ${GROUPS_PATH}`]: jsonResponse({ data: { id: NEW_GROUP_ID } }, 201) },
    });
    renderApp(PAGE);
    const dialog = await openCreateDialog(user);

    await user.type(field(es.directory['groups.create.name']), 'Nómina');
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['groups.create.submit'] }),
    );

    await waitFor(() => {
      expect(api.callsTo('POST', GROUPS_PATH)).toHaveLength(1);
    });
    expect(api.callsTo('POST', GROUPS_PATH)[0]?.body).toEqual({ name: 'Nómina' });
  });

  it('requires a name and sends nothing without it', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    const dialog = await openCreateDialog(user);

    await user.click(
      within(dialog).getByRole('button', { name: es.directory['groups.create.submit'] }),
    );

    expect(await within(dialog).findByText(es.common['validation.required'])).toBeVisible();
    expect(api.callsTo('POST', GROUPS_PATH)).toHaveLength(0);
  });

  it('shows GROUP.NAME_TAKEN on the name field and keeps the dialog open', async () => {
    const user = userEvent.setup();
    setup({ extra: { [`POST ${GROUPS_PATH}`]: problem(409, 'GROUP.NAME_TAKEN') } });
    renderApp(PAGE);
    const dialog = await openCreateDialog(user);

    await user.type(field(es.directory['groups.create.name']), 'Contabilidad');
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['groups.create.submit'] }),
    );

    await waitFor(() => {
      expect(field(es.directory['groups.create.name'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(dialog).getByText(es.errors['GROUP.NAME_TAKEN'])).toBeVisible();
    expect(screen.getByRole('dialog', { name: es.directory['groups.create.title'] })).toBeVisible();
  });
});

describe('group members', () => {
  it('lists the members with their role as text and offers add and remove to managers, without violations', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    const dialog = await openMembersDialog(user);

    const list = await within(dialog).findByRole('list', {
      name: es.directory['groups.members.listLabel'],
    });
    expect(within(list).getByText(MANAGER.displayName)).toBeVisible();
    expect(within(list).getByText(MEMBER.displayName)).toBeVisible();
    expect(within(list).getByText(es.directory['groups.role.manager'])).toBeVisible();
    expect(within(list).getByText(es.directory['groups.role.member'])).toBeVisible();
    expect(
      within(dialog).getByRole('button', {
        name: fill(es.directory['groups.members.remove.label'], { name: MEMBER.displayName }),
      }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: es.directory['groups.members.add.submit'] }),
    ).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('shows the list but no controls when the person cannot manage the members', async () => {
    const user = userEvent.setup();
    setup({
      extra: {
        [`GET /groups/${READONLY_GROUP_ID}/members`]: jsonResponse({ data: [MANAGER] }),
      },
    });
    renderApp(PAGE);
    const dialog = await openMembersDialog(user, READONLY_GROUP);

    expect(await within(dialog).findByText(MANAGER.displayName)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: /Quitar/ })).toBeNull();
    expect(
      within(dialog).queryByRole('button', { name: es.directory['groups.members.add.submit'] }),
    ).toBeNull();
  });

  it('shows an error with retry when the members cannot be loaded', async () => {
    const user = userEvent.setup();
    setup({ extra: { [`GET ${MEMBERS_PATH}`]: problem(500, 'INTERNAL') } });
    renderApp(PAGE);
    const dialog = await openMembersDialog(user);

    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: es.common['actions.retry'] })).toBeVisible();
  });

  it('adds the chosen person with the chosen role and shows the list the server returned', async () => {
    const user = userEvent.setup();
    const manager: GroupMember = { ...NEW_MEMBER, role: 'manager' };
    const api = setup({
      extra: {
        [`POST ${MEMBERS_PATH}`]: jsonResponse({ data: [MANAGER, MEMBER, manager] }),
      },
    });
    renderApp(PAGE);
    const dialog = await openMembersDialog(user);

    await user.click(
      await within(dialog).findByRole('radio', { name: new RegExp(CANDIDATE.displayName) }),
    );
    await user.selectOptions(field(es.directory['groups.members.add.role']), 'manager');
    // Cambiar el rol descarta la selección (puede dejar de ser elegible): se vuelve a elegir.
    await user.click(
      await within(dialog).findByRole('radio', { name: new RegExp(CANDIDATE.displayName) }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['groups.members.add.submit'] }),
    );

    expect(
      await screen.findByText(
        fill(es.directory['groups.members.add.toast'], { name: CANDIDATE.displayName }),
      ),
    ).toBeInTheDocument();
    const posts = api.callsTo('POST', MEMBERS_PATH);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ userId: CANDIDATE_ID, role: 'manager' });
    expect(await within(dialog).findByText(CANDIDATE.displayName)).toBeVisible();
    await waitFor(() => {
      expect(api.callsTo('GET', GROUPS_PATH).length).toBeGreaterThan(1);
    });
  });

  it('keeps the add button disabled until a person is chosen', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    const dialog = await openMembersDialog(user);

    const submit = await within(dialog).findByRole('button', {
      name: es.directory['groups.members.add.submit'],
    });
    expect(submit).toBeDisabled();
    await user.click(
      await within(dialog).findByRole('radio', { name: new RegExp(CANDIDATE.displayName) }),
    );
    expect(submit).toBeEnabled();
  });

  it('shows GROUP.MEMBER_EXISTS in the dialog when the server rejects the person', async () => {
    const user = userEvent.setup();
    setup({ extra: { [`POST ${MEMBERS_PATH}`]: problem(409, 'GROUP.MEMBER_EXISTS') } });
    renderApp(PAGE);
    const dialog = await openMembersDialog(user);

    await user.click(
      await within(dialog).findByRole('radio', { name: new RegExp(CANDIDATE.displayName) }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['groups.members.add.submit'] }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['GROUP.MEMBER_EXISTS'],
    );
  });

  it('does not offer people who are not Leaders when the role is manager', async () => {
    const user = userEvent.setup();
    const operator: DirectoryUser = {
      ...CANDIDATE,
      id: OPERATOR_ID,
      displayName: 'Olga Soto',
      rank: 3,
    };
    setup({
      extra: {
        'GET /users': jsonResponse({
          data: [CANDIDATE, operator],
          page: { nextCursor: null, limit: 25 },
        }),
        [`GET ${MEMBERS_PATH}`]: jsonResponse({ data: [MANAGER] }),
      },
    });
    renderApp(PAGE);
    const dialog = await openMembersDialog(user);

    expect(await within(dialog).findByRole('radio', { name: /Olga Soto/ })).toBeVisible();
    await user.selectOptions(field(es.directory['groups.members.add.role']), 'manager');

    expect(within(dialog).queryByRole('radio', { name: /Olga Soto/ })).toBeNull();
    expect(
      await within(dialog).findByRole('radio', { name: new RegExp(CANDIDATE.displayName) }),
    ).toBeVisible();
  });

  it('removes a member only after confirming and shows the list the server returned', async () => {
    const user = userEvent.setup();
    const api = setup({
      extra: {
        [`DELETE ${MEMBERS_PATH}/${MEMBER_ID}`]: jsonResponse({ data: [MANAGER] }),
      },
    });
    renderApp(PAGE);
    const dialog = await openMembersDialog(user);

    await user.click(
      await within(dialog).findByRole('button', {
        name: fill(es.directory['groups.members.remove.label'], { name: MEMBER.displayName }),
      }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: fill(es.directory['groups.members.remove.title'], { name: MEMBER.displayName }),
    });
    expect(api.callsTo('DELETE', `${MEMBERS_PATH}/${MEMBER_ID}`)).toHaveLength(0);
    await user.click(
      within(confirm).getByRole('button', { name: es.directory['groups.members.remove.confirm'] }),
    );

    expect(
      await screen.findByText(
        fill(es.directory['groups.members.remove.toast'], { name: MEMBER.displayName }),
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('DELETE', `${MEMBERS_PATH}/${MEMBER_ID}`)).toHaveLength(1);
    await waitFor(() => {
      expect(within(dialog).queryByText(MEMBER.displayName)).toBeNull();
    });
  });

  it('does not remove anyone when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    const dialog = await openMembersDialog(user);

    await user.click(
      await within(dialog).findByRole('button', {
        name: fill(es.directory['groups.members.remove.label'], { name: MEMBER.displayName }),
      }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: fill(es.directory['groups.members.remove.title'], { name: MEMBER.displayName }),
    });
    await user.click(within(confirm).getByRole('button', { name: es.common['actions.cancel'] }));

    expect(api.callsTo('DELETE', `${MEMBERS_PATH}/${MEMBER_ID}`)).toHaveLength(0);
    expect(within(dialog).getByText(MEMBER.displayName)).toBeVisible();
  });

  it('shows GROUP.LAST_MANAGER in the confirmation and keeps the member', async () => {
    const user = userEvent.setup();
    setup({
      extra: {
        [`DELETE ${MEMBERS_PATH}/${MANAGER_ID}`]: problem(409, 'GROUP.LAST_MANAGER'),
      },
    });
    renderApp(PAGE);
    const dialog = await openMembersDialog(user);

    await user.click(
      await within(dialog).findByRole('button', {
        name: fill(es.directory['groups.members.remove.label'], { name: MANAGER.displayName }),
      }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: fill(es.directory['groups.members.remove.title'], { name: MANAGER.displayName }),
    });
    await user.click(
      within(confirm).getByRole('button', { name: es.directory['groups.members.remove.confirm'] }),
    );

    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      es.errors['GROUP.LAST_MANAGER'],
    );
    expect(within(dialog).getByText(MANAGER.displayName)).toBeInTheDocument();
  });
});
