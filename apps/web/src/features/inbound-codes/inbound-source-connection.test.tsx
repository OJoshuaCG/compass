import type { InboundSourceConnection, InboundSourceSummary, Permission } from '@iam/contracts';
import { loadInboundCatalog } from '@iam/i18n';
import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const catalogs = await loadInboundCatalog();
const t = catalogs['es-MX'];

const MANAGE_ID = '22222222-2222-4222-8222-222222222221';
const EDIT_ID = '22222222-2222-4222-8222-222222222222';
const USE_ID = '22222222-2222-4222-8222-222222222223';
const ARCHIVED_ID = '22222222-2222-4222-8222-222222222224';

const PAGE = '/inbound/sources';
const SOURCES_PATH = '/inbound/sources';
const PERMISSIONS: Permission[] = ['inbound.configure'];
/** Valor ficticio: comprueba que la contraseña del buzón no se queda en ningún almacén. */
const PASSWORD = 'buzon-Secreto-9f3a';

const withName = (template: string, name: string) => template.replace('{{name}}', name);
const connectionPath = (sourceId: string) => `/inbound/sources/${sourceId}/connection`;

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
const ARCHIVED = sourceFixture({
  id: ARCHIVED_ID,
  address: 'viejo@example.com',
  displayName: 'Buzón archivado',
  status: 'archived',
});

const storedConnection = (
  overrides: Partial<InboundSourceConnection> = {},
): InboundSourceConnection => ({
  sourceId: EDIT_ID,
  host: 'imap.example.com',
  port: 993,
  tlsMode: 'tls',
  username: 'soporte@example.com',
  authservId: 'mx.example.com',
  acceptedRecipients: ['soporte@example.com', 'ayuda@example.com'],
  hasPassword: true,
  updatedAt: '2026-02-01T12:00:00.000Z',
  ...overrides,
});

type Routes = Parameters<typeof stubApi>[0];

function setup(routes: Routes = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: PERMISSIONS, rank: 2 })),
    [`GET ${SOURCES_PATH}`]: jsonResponse({ data: [MANAGED, EDITABLE, USABLE, ARCHIVED] }),
    'GET /inbound/views': jsonResponse({ data: [] }),
    [`GET ${connectionPath(MANAGE_ID)}`]: jsonResponse({ connection: null }),
    [`GET ${connectionPath(EDIT_ID)}`]: jsonResponse({ connection: storedConnection() }),
    ...routes,
  });
}

const connectionLabel = (name: string) => withName(t['sources.action.connectionLabel'], name);
const dialogTitle = (name: string) => withName(t['sources.connection.title'], name);

async function openConnection(
  user: ReturnType<typeof userEvent.setup>,
  source: InboundSourceSummary,
): Promise<HTMLElement> {
  await screen.findByRole('cell', { name: 'Buzón de accesos' });
  await user.click(screen.getByRole('button', { name: connectionLabel(source.displayName) }));
  const dialog = await screen.findByRole('dialog', { name: dialogTitle(source.displayName) });
  // El formulario se monta cuando llega la conexión guardada.
  await within(dialog).findByRole('button', { name: t['sources.connection.submit'] });
  return dialog;
}

describe('connection action', () => {
  it('is offered only for mail sources that are not archived, from EDIT up', async () => {
    setup();
    renderApp(PAGE);
    await screen.findByRole('cell', { name: 'Buzón de accesos' });

    expect(screen.getByRole('button', { name: connectionLabel('Buzón de accesos') })).toBeVisible();
    // Suspendida pero editable: se puede preparar la conexión antes de reactivarla.
    expect(screen.getByRole('button', { name: connectionLabel('Buzón de soporte') })).toBeVisible();
    expect(screen.queryByRole('button', { name: connectionLabel('Buzón de ventas') })).toBeNull();
    expect(screen.queryByRole('button', { name: connectionLabel('Buzón archivado') })).toBeNull();
  });
});

describe('new connection at MANAGE', () => {
  it('prefills the source address and sends the exact body with the port taken from the mode', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`PUT ${connectionPath(MANAGE_ID)}`]: jsonResponse(
        storedConnection({ sourceId: MANAGE_ID, port: 143, tlsMode: 'starttls' }),
      ),
    });
    const { queryClient } = renderApp(PAGE);
    const dialog = await openConnection(user, MANAGED);
    expect(await axeViolations(dialog)).toEqual([]);

    expect(field(t['sources.connection.username'])).toHaveValue('accesos@example.com');
    expect(field(t['sources.connection.recipients'])).toHaveValue('accesos@example.com');
    expect(within(dialog).getByText(t['sources.connection.passwordNone'])).toBeVisible();

    await user.type(field(t['sources.connection.host']), ' IMAP.Example.com ');
    await user.selectOptions(field(t['sources.connection.tlsMode']), 'starttls');
    await user.type(field(t['sources.connection.authservId']), 'mx.example.com');
    await user.clear(field(t['sources.connection.recipients']));
    await user.type(
      field(t['sources.connection.recipients']),
      'accesos@example.com, alertas@example.com',
    );
    await user.type(field(t['sources.connection.password']), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: t['sources.connection.submit'] }));

    expect(
      await screen.findByText(withName(t['sources.connection.toast'], 'Buzón de accesos')),
    ).toBeInTheDocument();
    const calls = api.callsTo('PUT', connectionPath(MANAGE_ID));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      host: 'imap.example.com',
      port: 143,
      tlsMode: 'starttls',
      username: 'accesos@example.com',
      authservId: 'mx.example.com',
      acceptedRecipients: ['accesos@example.com', 'alertas@example.com'],
      password: PASSWORD,
    });
    // Una caché de idempotencia guardaría el cuerpo con la contraseña: el PUT no lleva clave.
    expect(calls[0]?.headers.get('Idempotency-Key')).toBeNull();
    expect(screen.queryByRole('dialog', { name: dialogTitle('Buzón de accesos') })).toBeNull();
    // `textContent` no incluye el valor de los campos: se busca también como valor mostrado.
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(window.location.href).not.toContain(PASSWORD);
    expectNoSecretsStored(queryClient, [PASSWORD]);
  });

  it('does not warn about deleting a password when none is stored', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    const dialog = await openConnection(user, MANAGED);

    await user.type(field(t['sources.connection.host']), 'imap.example.com');
    await user.clear(field(t['sources.connection.username']));
    await user.type(field(t['sources.connection.username']), 'otro@example.com');
    expect(within(dialog).queryByText(t['sources.connection.clearsPassword'])).toBeNull();
  });

  it('ignores a save that finishes after the dialog was closed', async () => {
    const user = userEvent.setup();
    let answer: (response: Response) => void = () => undefined;
    setup({
      [`PUT ${connectionPath(MANAGE_ID)}`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    renderApp(PAGE);
    const dialog = await openConnection(user, MANAGED);

    await user.type(field(t['sources.connection.host']), 'imap.example.com');
    await user.type(field(t['sources.connection.authservId']), 'mx.example.com');
    await user.click(within(dialog).getByRole('button', { name: t['sources.connection.submit'] }));
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    expect(screen.queryByRole('dialog', { name: dialogTitle('Buzón de accesos') })).toBeNull();

    // Se abre otro diálogo antes de que llegue la respuesta: el éxito tardío no debe cerrarlo.
    await user.click(screen.getByRole('button', { name: connectionLabel('Buzón de soporte') }));
    const other = await screen.findByRole('dialog', { name: dialogTitle('Buzón de soporte') });
    await act(async () => {
      answer(jsonResponse(storedConnection({ sourceId: MANAGE_ID })));
      // Deja que la respuesta tardía recorra fetch, lectura del cuerpo y validación antes de mirar.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(other).toBeVisible();
    expect(
      screen.queryByText(withName(t['sources.connection.toast'], 'Buzón de accesos')),
    ).toBeNull();
  });

  it('keeps what was typed when the window regains focus (no background reload)', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    await openConnection(user, MANAGED);
    await user.type(field(t['sources.connection.password']), PASSWORD);

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(field(t['sources.connection.password'])).toHaveValue(PASSWORD);
    expect(api.callsTo('GET', connectionPath(MANAGE_ID))).toHaveLength(1);
    act(() => {
      focusManager.setFocused(undefined);
    });
  });

  it('blocks an IP address as host without sending anything', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    const dialog = await openConnection(user, MANAGED);

    await user.type(field(t['sources.connection.host']), '192.168.1.10');
    await user.type(field(t['sources.connection.authservId']), 'mx.example.com');
    await user.click(within(dialog).getByRole('button', { name: t['sources.connection.submit'] }));

    await waitFor(() => {
      expect(field(t['sources.connection.host'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(api.callsTo('PUT', connectionPath(MANAGE_ID))).toHaveLength(0);
  });

  it('shows INBOUND.RECIPIENT_NOT_ALLOWED inside the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    setup({
      [`PUT ${connectionPath(MANAGE_ID)}`]: problem(422, 'INBOUND.RECIPIENT_NOT_ALLOWED'),
    });
    renderApp(PAGE);
    const dialog = await openConnection(user, MANAGED);

    await user.type(field(t['sources.connection.host']), 'imap.example.com');
    await user.type(field(t['sources.connection.authservId']), 'mx.example.com');
    await user.click(within(dialog).getByRole('button', { name: t['sources.connection.submit'] }));

    expect(
      await within(dialog).findByText(new RegExp(es.errors['INBOUND.RECIPIENT_NOT_ALLOWED'])),
    ).toBeVisible();
    expect(screen.getByRole('dialog', { name: dialogTitle('Buzón de accesos') })).toBeVisible();
  });

  it('marks the recipients field when the server rejects acceptedRecipients with a 422', async () => {
    const user = userEvent.setup();
    setup({
      [`PUT ${connectionPath(MANAGE_ID)}`]: problem(422, 'VALIDATION.FAILED', {
        errors: [{ field: 'acceptedRecipients', code: 'invalid' }],
      }),
    });
    renderApp(PAGE);
    const dialog = await openConnection(user, MANAGED);

    await user.type(field(t['sources.connection.host']), 'imap.example.com');
    await user.type(field(t['sources.connection.authservId']), 'mx.example.com');
    await user.click(within(dialog).getByRole('button', { name: t['sources.connection.submit'] }));

    await waitFor(() => {
      expect(field(t['sources.connection.recipients'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(field(t['sources.connection.host'])).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('reauthenticates and retries the save exactly once with the same body', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = setup({
      [`PUT ${connectionPath(MANAGE_ID)}`]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(403, 'AUTHZ.REAUTH_REQUIRED')
          : jsonResponse(storedConnection({ sourceId: MANAGE_ID }));
      },
      'POST /auth/reauth': noContent(),
    });
    const { queryClient } = renderApp(PAGE);
    const dialog = await openConnection(user, MANAGED);

    await user.type(field(t['sources.connection.host']), 'imap.example.com');
    await user.type(field(t['sources.connection.authservId']), 'mx.example.com');
    await user.type(field(t['sources.connection.password']), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: t['sources.connection.submit'] }));

    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(reauth).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '246810',
    );
    await user.click(within(reauth).getByRole('button', { name: es.common['reauth.submit'] }));

    expect(
      await screen.findByText(withName(t['sources.connection.toast'], 'Buzón de accesos')),
    ).toBeInTheDocument();
    const calls = api.callsTo('PUT', connectionPath(MANAGE_ID));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toEqual(calls[0]?.body);
    expect(calls[1]?.headers.get('Idempotency-Key')).toBeNull();
    expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(1);
    expectNoSecretsStored(queryClient, [PASSWORD]);
  });
});

describe('stored connection at EDIT', () => {
  it('shows recipients read-only and keeps the stored password and recipients when left untouched', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`PUT ${connectionPath(EDIT_ID)}`]: jsonResponse(storedConnection()),
    });
    renderApp(PAGE);
    const dialog = await openConnection(user, EDITABLE);

    expect(field(t['sources.connection.host'])).toHaveValue('imap.example.com');
    expect(within(dialog).queryByRole('textbox', { name: /Destinatarios/ })).toBeNull();
    expect(within(dialog).getByText('soporte@example.com, ayuda@example.com')).toBeVisible();
    expect(within(dialog).getByText(t['sources.connection.recipientsManageOnly'])).toBeVisible();
    expect(within(dialog).getByText(t['sources.connection.passwordKeep'])).toBeVisible();
    expect(within(dialog).queryByText(t['sources.connection.clearsPassword'])).toBeNull();

    await user.clear(field(t['sources.connection.authservId']));
    await user.type(field(t['sources.connection.authservId']), 'mx2.example.com');
    await user.click(within(dialog).getByRole('button', { name: t['sources.connection.submit'] }));

    expect(
      await screen.findByText(withName(t['sources.connection.toast'], 'Buzón de soporte')),
    ).toBeInTheDocument();
    // Sin contraseña ni destinatarios: el servidor conserva los guardados.
    expect(api.callsTo('PUT', connectionPath(EDIT_ID))[0]?.body).toEqual({
      host: 'imap.example.com',
      port: 993,
      tlsMode: 'tls',
      username: 'soporte@example.com',
      authservId: 'mx2.example.com',
    });
  });

  it('warns that the stored password will be deleted when the server changes without a new one', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    const dialog = await openConnection(user, EDITABLE);

    await user.clear(field(t['sources.connection.host']));
    await user.type(field(t['sources.connection.host']), 'imap.otro.com');
    expect(await within(dialog).findByText(t['sources.connection.clearsPassword'])).toBeVisible();

    await user.type(field(t['sources.connection.password']), PASSWORD);
    expect(within(dialog).queryByText(t['sources.connection.clearsPassword'])).toBeNull();
  });

  it('also warns when only the security mode or the user changes', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    const dialog = await openConnection(user, EDITABLE);

    await user.selectOptions(field(t['sources.connection.tlsMode']), 'starttls');
    expect(await within(dialog).findByText(t['sources.connection.clearsPassword'])).toBeVisible();
    await user.selectOptions(field(t['sources.connection.tlsMode']), 'tls');
    expect(within(dialog).queryByText(t['sources.connection.clearsPassword'])).toBeNull();

    await user.clear(field(t['sources.connection.username']));
    await user.type(field(t['sources.connection.username']), 'otro@example.com');
    expect(await within(dialog).findByText(t['sources.connection.clearsPassword'])).toBeVisible();
  });

  it('sends no password after changing the server with the field empty (the server deletes it)', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`PUT ${connectionPath(EDIT_ID)}`]: jsonResponse(
        storedConnection({ host: 'imap.otro.com', hasPassword: false }),
      ),
    });
    renderApp(PAGE);
    const dialog = await openConnection(user, EDITABLE);

    await user.clear(field(t['sources.connection.host']));
    await user.type(field(t['sources.connection.host']), 'imap.otro.com');
    await user.click(within(dialog).getByRole('button', { name: t['sources.connection.submit'] }));

    expect(
      await screen.findByText(withName(t['sources.connection.toast'], 'Buzón de soporte')),
    ).toBeInTheDocument();
    expect(api.callsTo('PUT', connectionPath(EDIT_ID))[0]?.body).toEqual({
      host: 'imap.otro.com',
      port: 993,
      tlsMode: 'tls',
      username: 'soporte@example.com',
      authservId: 'mx.example.com',
    });
  });

  it('sends a new password from EDIT without acceptedRecipients', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`PUT ${connectionPath(EDIT_ID)}`]: jsonResponse(storedConnection()),
    });
    const { queryClient } = renderApp(PAGE);
    const dialog = await openConnection(user, EDITABLE);

    await user.type(field(t['sources.connection.password']), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: t['sources.connection.submit'] }));

    expect(
      await screen.findByText(withName(t['sources.connection.toast'], 'Buzón de soporte')),
    ).toBeInTheDocument();
    const body = api.callsTo('PUT', connectionPath(EDIT_ID))[0]?.body;
    expect(body).toEqual({
      host: 'imap.example.com',
      port: 993,
      tlsMode: 'tls',
      username: 'soporte@example.com',
      authservId: 'mx.example.com',
      password: PASSWORD,
    });
    expectNoSecretsStored(queryClient, [PASSWORD]);
  });
});
