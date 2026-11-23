import type { PendingInvitation, Permission } from '@iam/contracts';
import { loadDirectoryCatalog } from '@iam/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const PENDING_ID = '11111111-1111-4111-8111-111111111111';
const NEW_ID = '33333333-3333-4333-8333-333333333333';
// Valor reconocible para buscarlo en el DOM, el almacenamiento y la caché de Query.
const LINK_TOKEN = 'SECRET-LINK-TOKEN-1234567890';
const LINK = `https://app.example.com/invitations/accept?token=${LINK_TOKEN}`;

const WITH_LINK: Permission[] = ['user.invite', 'user.invite_link'];

const PENDING: PendingInvitation = {
  id: PENDING_ID,
  email: 'ana@example.com',
  rank: 3,
  createdAt: '2030-01-01T10:00:00.000Z',
  expiresAt: '2030-01-04T10:00:00.000Z',
  expired: false,
};

const withLinkBody = (emailSent: boolean) => ({
  id: NEW_ID,
  email: 'nuevo@example.com',
  rank: 3,
  expiresAt: '2030-01-04T12:00:00.000Z',
  link: LINK,
  emailSent,
});
const withLinkResponse = (emailSent: boolean) => () => jsonResponse(withLinkBody(emailSent), 201);
const plainResponse = () =>
  jsonResponse(
    { id: NEW_ID, email: 'nuevo@example.com', rank: 3, expiresAt: '2030-01-04T12:00:00.000Z' },
    201,
  );
const resendLinkLabel = (email: string) =>
  es.directory['invitations.resendWithLinkLabel'].replace('{{email}}', email);

function setup(
  extra: Record<string, Parameters<typeof stubApi>[0][string]> = {},
  permissions: Permission[] = WITH_LINK,
) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    'GET /users': jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    'GET /invitations': jsonResponse({ data: [PENDING], page: { nextCursor: null, limit: 25 } }),
    ...extra,
  });
}

async function openInviteDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: es.directory['users.invite'] }));
  return screen.findByRole('dialog', { name: es.directory['invite.title'] });
}

const linkOption = (dialog: HTMLElement) =>
  within(dialog).queryByRole('checkbox', { name: es.directory['invite.link.option'] });

/** Todo lo que el navegador podría haber guardado: ni una pizca del enlace debe aparecer. */
function storedText(): string {
  const entries: string[] = [];
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) entries.push(key, storage.getItem(key) ?? '');
    }
  }
  return entries.join('\n');
}

describe('invite dialog: show the invitation link', () => {
  it('hides the checkbox without user.invite_link', async () => {
    const user = userEvent.setup();
    setup({}, ['user.invite']);
    renderApp('/users');
    const dialog = await openInviteDialog(user);
    await within(dialog).findByRole('button', { name: es.directory['invite.submit'] });
    expect(linkOption(dialog)).toBeNull();
  });

  it('shows an unchecked, described checkbox with user.invite_link', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/users');
    const dialog = await openInviteDialog(user);
    const checkbox = await within(dialog).findByRole('checkbox', {
      name: es.directory['invite.link.option'],
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAccessibleDescription(es.directory['invite.link.optionHelp']);
  });

  it('calls /invitations/with-link without Idempotency-Key and shows the link in the same dialog', async () => {
    const user = userEvent.setup();
    const api = setup({ 'POST /invitations/with-link': withLinkResponse(true) });
    renderApp('/users');
    const dialog = await openInviteDialog(user);
    await user.click(
      await within(dialog).findByRole('checkbox', { name: es.directory['invite.link.option'] }),
    );
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));

    const linkField = await within(dialog).findByRole('textbox', {
      name: es.directory['link.field'],
    });
    expect(linkField).toHaveValue(LINK);
    expect(linkField).toHaveAttribute('readonly');
    // Es la misma ventana: el título pasa del formulario al enlace.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: es.directory['link.title'] })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /Correo/ })).toBeNull();

    expect(api.callsTo('POST', '/invitations')).toHaveLength(0);
    const calls = api.callsTo('POST', '/invitations/with-link');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ email: 'nuevo@example.com', rank: 3, roleIds: [] });
    expect(calls[0]?.headers.has('Idempotency-Key')).toBe(false);
    expect(calls[0]?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');

    // El foco pasa al encabezado del panel, que se anuncia como estado.
    const heading = within(dialog).getByText(
      es.directory['link.heading'].replace('{{email}}', 'nuevo@example.com'),
    );
    expect(heading).toHaveAttribute('role', 'status');
    expect(heading).toHaveFocus();
    expect(
      within(dialog).getByText(
        es.directory['link.emailSent'].replace('{{email}}', 'nuevo@example.com'),
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(es.directory['link.warning'])).toBeInTheDocument();
    expect(within(dialog).getByText(/2030/)).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('copies the link and announces it with role=status', async () => {
    const user = userEvent.setup();
    setup({ 'POST /invitations/with-link': withLinkResponse(true) });
    renderApp('/users');
    const dialog = await openInviteDialog(user);
    await user.click(
      await within(dialog).findByRole('checkbox', { name: es.directory['invite.link.option'] }),
    );
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));

    await user.click(
      await within(dialog).findByRole('button', { name: es.directory['link.copy'] }),
    );
    expect(await navigator.clipboard.readText()).toBe(LINK);
    expect(
      await within(dialog).findByText(es.common['clipboard.copied'], {
        selector: '[role="status"]',
      }),
    ).toBeInTheDocument();
  });

  it('warns clearly when the email could not be sent, and still shows the link', async () => {
    const user = userEvent.setup();
    setup({ 'POST /invitations/with-link': withLinkResponse(false) });
    renderApp('/users');
    const dialog = await openInviteDialog(user);
    await user.click(
      await within(dialog).findByRole('checkbox', { name: es.directory['invite.link.option'] }),
    );
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));

    expect(await within(dialog).findByText(es.directory['link.emailFailed'])).toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        es.directory['link.emailSent'].replace('{{email}}', 'nuevo@example.com'),
      ),
    ).toBeNull();
    expect(within(dialog).getByRole('textbox', { name: es.directory['link.field'] })).toHaveValue(
      LINK,
    );
  });

  it('uses the regular route and shows no link when the checkbox is left unchecked', async () => {
    const user = userEvent.setup();
    const api = setup({ 'POST /invitations': plainResponse });
    renderApp('/users');
    const dialog = await openInviteDialog(user);
    await within(dialog).findByRole('checkbox', { name: es.directory['invite.link.option'] });
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));

    await waitFor(() => {
      expect(api.callsTo('POST', '/invitations')).toHaveLength(1);
    });
    expect(api.callsTo('POST', '/invitations/with-link')).toHaveLength(0);
    // Hoy: la ruta con idempotencia y sin enlace; el diálogo se cierra.
    expect(api.callsTo('POST', '/invitations')[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.queryByDisplayValue(LINK)).toBeNull();
  });

  it('drops the link when the dialog is closed and never shows it again', async () => {
    const user = userEvent.setup();
    setup({ 'POST /invitations/with-link': withLinkResponse(true) });
    const { queryClient } = renderApp('/users');
    const dialog = await openInviteDialog(user);
    await user.click(
      await within(dialog).findByRole('checkbox', { name: es.directory['invite.link.option'] }),
    );
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    await within(dialog).findByRole('textbox', { name: es.directory['link.field'] });

    await user.click(within(dialog).getByRole('button', { name: es.directory['link.close'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.textContent).not.toContain(LINK_TOKEN);
    expect(screen.queryByDisplayValue(LINK)).toBeNull();

    // Reabrir da un formulario limpio, no el enlace anterior.
    const reopened = await openInviteDialog(user);
    expect(
      within(reopened).queryByRole('textbox', { name: es.directory['link.field'] }),
    ).toBeNull();
    expect(document.body.textContent).not.toContain(LINK_TOKEN);

    // La caché de Query (consultas y mutaciones) nunca guardó el enlace.
    const cached = JSON.stringify([
      ...queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      ...queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => [mutation.state.data, mutation.state.variables]),
    ]);
    expect(cached).not.toContain(LINK_TOKEN);
  });

  it('also drops the link when it is closed with Escape', async () => {
    const user = userEvent.setup();
    setup({ 'POST /invitations/with-link': withLinkResponse(true) });
    renderApp('/users');
    const dialog = await openInviteDialog(user);
    await user.click(
      await within(dialog).findByRole('checkbox', { name: es.directory['invite.link.option'] }),
    );
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    await within(dialog).findByRole('textbox', { name: es.directory['link.field'] });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.textContent).not.toContain(LINK_TOKEN);
  });

  it('never writes the link to localStorage or sessionStorage, the URL or an attribute', async () => {
    const user = userEvent.setup();
    setup({ 'POST /invitations/with-link': withLinkResponse(true) });
    const { router } = renderApp('/users');
    const dialog = await openInviteDialog(user);
    await user.click(
      await within(dialog).findByRole('checkbox', { name: es.directory['invite.link.option'] }),
    );
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
    const linkField = await within(dialog).findByRole('textbox', {
      name: es.directory['link.field'],
    });
    await user.click(within(dialog).getByRole('button', { name: es.directory['link.copy'] }));

    expect(storedText()).not.toContain(LINK_TOKEN);
    expect(router.state.location.href).not.toContain(LINK_TOKEN);
    // El enlace solo está en el valor del campo, nunca en otro atributo (data-*, title, href...).
    // React refleja el valor de un campo controlado en su atributo `value`, así que ese atributo
    // se excluye únicamente en el campo del enlace: si el token aparece en otro campo, falla.
    const attributeValues = [...document.body.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes]
        .filter((attribute) => !(element === linkField && attribute.name === 'value'))
        .map((attribute) => attribute.value),
    );
    expect(attributeValues.some((value) => value.includes(LINK_TOKEN))).toBe(false);
  });

  it('shows the server error in the form and keeps it open when with-link is denied', async () => {
    const user = userEvent.setup();
    setup({ 'POST /invitations/with-link': problem(403, 'AUTHZ.PERMISSION') });
    renderApp('/users');
    const dialog = await openInviteDialog(user);
    await user.click(
      await within(dialog).findByRole('checkbox', { name: es.directory['invite.link.option'] }),
    );
    await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
    await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.PERMISSION'],
    );
    expect(within(dialog).queryByRole('textbox', { name: es.directory['link.field'] })).toBeNull();
  });

  it('offers the same texts in English', async () => {
    const en = (await loadDirectoryCatalog())['en-US'];
    const user = userEvent.setup();
    setup({ 'POST /invitations/with-link': withLinkResponse(true) });
    renderApp('/users', 'en-US');
    await user.click(await screen.findByRole('button', { name: en['users.invite'] }));
    const dialog = await screen.findByRole('dialog', { name: en['invite.title'] });
    await user.click(
      await within(dialog).findByRole('checkbox', { name: en['invite.link.option'] }),
    );
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${en['invite.email']}`)),
      'nuevo@example.com',
    );
    await user.click(within(dialog).getByRole('button', { name: en['invite.submit'] }));
    expect(
      await within(dialog).findByRole('button', { name: en['link.copy'] }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(en['link.warning'])).toBeInTheDocument();
  });
});

describe('invitations tab: resend and show the link', () => {
  const resendPath = `/invitations/${PENDING_ID}/resend-with-link`;
  const resendBody = () =>
    jsonResponse({ ...withLinkBody(true), id: PENDING_ID, email: 'ana@example.com' }, 201);

  it('is hidden without user.invite_link', async () => {
    setup({}, ['user.invite']);
    renderApp('/users?view=invitations');
    await screen.findByText('ana@example.com');
    expect(screen.queryByRole('button', { name: resendLinkLabel('ana@example.com') })).toBeNull();
    expect(
      screen.getByRole('button', {
        name: es.directory['invitations.resendLabel'].replace('{{email}}', 'ana@example.com'),
      }),
    ).toBeInTheDocument();
  });

  it('resends with link, shows the panel in a dialog and loses it on close', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST ${resendPath}`]: resendBody });
    const { queryClient } = renderApp('/users?view=invitations');
    await screen.findByText('ana@example.com');
    await user.click(screen.getByRole('button', { name: resendLinkLabel('ana@example.com') }));

    const dialog = await screen.findByRole('dialog', { name: es.directory['link.title'] });
    expect(within(dialog).getByRole('textbox', { name: es.directory['link.field'] })).toHaveValue(
      LINK,
    );
    expect(within(dialog).getByRole('button', { name: es.directory['link.copy'] })).toBeVisible();
    const call = api.callsTo('POST', resendPath)[0];
    expect(call?.headers.has('Idempotency-Key')).toBe(false);
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(api.callsTo('POST', `/invitations/${PENDING_ID}/resend`)).toHaveLength(0);
    expect(storedText()).not.toContain(LINK_TOKEN);

    await user.click(within(dialog).getByRole('button', { name: es.directory['link.close'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.textContent).not.toContain(LINK_TOKEN);
    expect(screen.queryByDisplayValue(LINK)).toBeNull();
    const cached = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    );
    expect(cached).not.toContain(LINK_TOKEN);
  });

  it('shows the permission error inline and no dialog', async () => {
    const user = userEvent.setup();
    setup({ [`POST ${resendPath}`]: problem(403, 'AUTHZ.PERMISSION') });
    renderApp('/users?view=invitations');
    await screen.findByText('ana@example.com');
    await user.click(screen.getByRole('button', { name: resendLinkLabel('ana@example.com') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.PERMISSION']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
