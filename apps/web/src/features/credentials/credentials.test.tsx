import type { AccountListItem, Credential, Permission, ShareLevel } from '@iam/contracts';
import { act, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import {
  announcedStatusTexts,
  chooseRowMenuAction,
  es,
  expectNoSecretsStored,
  field,
  openRowMenu,
  rowMenuItemTexts,
} from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const ACCOUNT_ID = '33333333-3333-4333-8333-333333333331';
const CREDENTIAL_ID = '44444444-4444-4444-8444-444444444441';
const OTHER_CREDENTIAL_ID = '44444444-4444-4444-8444-444444444442';
const NEW_CREDENTIAL_ID = '44444444-4444-4444-8444-444444444443';
const PLATFORM_ID = '11111111-1111-4111-8111-111111111111';
const CREATOR_ID = '5c9e6f3e-4c1a-4a53-9d9e-6b0f0a1f7a01';

const PASSWORD = 'S3cr3t-de-prueba-Ωmega';
const USERNAME = 'rh-usuario@example.com';
const HIDE_AFTER_MS = 30_000;

const ALL_PERMISSIONS: Permission[] = [
  'credential.create',
  'credential.update',
  'credential.restore_version',
  'credential.reveal_password',
];

const accountFixture = (myLevel: ShareLevel | null): AccountListItem => ({
  id: ACCOUNT_ID,
  platformId: PLATFORM_ID,
  displayName: 'Nómina',
  handle: null,
  ownerGroupId: null,
  tags: [],
  status: 'active',
  myLevel,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastChangedAt: null,
  passwordAge: 'none',
});

const ROTATED: Credential = {
  id: CREDENTIAL_ID,
  accountId: ACCOUNT_ID,
  label: 'Portal de nómina',
  kind: 'password',
  lastRotatedAt: '2026-03-01T12:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const NEVER_ROTATED: Credential = {
  id: OTHER_CREDENTIAL_ID,
  accountId: ACCOUNT_ID,
  label: 'Banco',
  kind: 'password_totp',
  lastRotatedAt: null,
  createdAt: '2026-01-02T00:00:00.000Z',
};

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    template,
  );

const revealLabel = (label: string) => fill(es.credentials['action.revealLabel'], { label });
const menuLabel = (label: string) => fill(es.credentials['action.rowMenu'], { label });
const copyLabel = (label: string) => fill(es.credentials['action.copyUsernameLabel'], { label });
const changePasswordItem = es.credentials['action.changePassword'];
const historyItem = es.credentials['action.history'];

function setup(
  options: {
    level?: ShareLevel | null;
    permissions?: Permission[];
    extra?: Record<string, Parameters<typeof stubApi>[0][string]>;
  } = {},
) {
  const { level = 'MANAGE', permissions = ALL_PERMISSIONS, extra = {} } = options;
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    [`GET /accounts/${ACCOUNT_ID}`]: jsonResponse(accountFixture(level)),
    [`GET /accounts/${ACCOUNT_ID}/credentials`]: jsonResponse({ data: [ROTATED, NEVER_ROTATED] }),
    ...extra,
  });
}

const PAGE = `/accounts/${ACCOUNT_ID}/credentials`;
/** Las tarjetas llegan después del estado de carga: se espera a la de la primera credencial. */
const rowsLoaded = () => screen.findByRole('heading', { level: 3, name: ROTATED.label });

afterEach(() => {
  vi.useRealTimers();
});

describe('credentials list', () => {
  it('shows the account header and one card per credential, without violations', async () => {
    setup({
      extra: {
        'GET /platforms': jsonResponse({
          data: [
            {
              id: PLATFORM_ID,
              name: 'Portal RH',
              slug: 'portal-rh',
              loginUrl: null,
              supportsTotp: false,
              isGlobal: true,
            },
          ],
        }),
      },
    });
    const { container } = renderApp(PAGE);
    await rowsLoaded();
    expect(screen.getByRole('heading', { level: 1, name: 'Nómina' })).toBeInTheDocument();
    // La plataforma aparece en el encabezado y en "Información de la cuenta".
    expect(await screen.findAllByText('Portal RH')).toHaveLength(2);
    expect(
      screen.getByRole('heading', { level: 2, name: es.credentials['info.title'] }),
    ).toBeVisible();
    expect(
      screen.getByText(
        fill(es.credentials['account.level'], { level: es.credentials['level.MANAGE'] }),
      ),
    ).toBeInTheDocument();
    const list = screen.getByRole('list', { name: es.credentials.caption });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    // El tipo (insignia) y el campo se llaman igual en una credencial solo de contraseña.
    expect(
      within(cards[0] as HTMLElement).getAllByText(es.credentials['kind.password']),
    ).toHaveLength(2);
    expect(
      within(cards[1] as HTMLElement).getByText(es.credentials['kind.password_totp']),
    ).toBeVisible();
    expect(
      within(cards[1] as HTMLElement).getByText(es.credentials['rotated.never']),
    ).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('is reachable from the accounts screen', async () => {
    const user = userEvent.setup();
    setup({
      extra: {
        'GET /accounts': jsonResponse({
          data: [accountFixture('USE')],
          page: { nextCursor: null, limit: 25 },
        }),
        'GET /platforms': jsonResponse({ data: [] }),
      },
    });
    const { router } = renderApp('/accounts');
    await user.click(
      await screen.findByRole('link', {
        name: fill(es.accounts['action.credentialsLabel'], { name: 'Nómina' }),
      }),
    );
    await rowsLoaded();
    expect(router.state.location.pathname).toBe(PAGE);
  });

  it('shows an empty state', async () => {
    setup({ extra: { [`GET /accounts/${ACCOUNT_ID}/credentials`]: jsonResponse({ data: [] }) } });
    renderApp(PAGE);
    expect(await screen.findByText(es.credentials['empty.title'])).toBeInTheDocument();
  });

  it('shows a translated error with Retry when the list is denied', async () => {
    setup({
      extra: { [`GET /accounts/${ACCOUNT_ID}/credentials`]: problem(403, 'AUTHZ.SHARE') },
    });
    renderApp(PAGE);
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });

  it('shows not found when the account is not visible', async () => {
    setup({ extra: { [`GET /accounts/${ACCOUNT_ID}`]: problem(404, 'NOT_FOUND') } });
    renderApp(PAGE);
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors.NOT_FOUND);
  });

  it('answers not found for an identifier that is not a UUID, without calling the API', async () => {
    const api = setup();
    renderApp('/accounts/no-es-uuid/credentials');
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeInTheDocument();
    expect(api.callsTo('GET', '/accounts/no-es-uuid')).toHaveLength(0);
  });
});

describe('account options', () => {
  const options = () => screen.queryByRole('heading', { name: es.credentials['options.title'] });

  it('offers edit and archive only with the account permission AND the level', async () => {
    setup({ level: 'MANAGE', permissions: ['account.update', 'account.archive'] });
    const first = renderApp(PAGE);
    await rowsLoaded();
    expect(options()).toBeVisible();
    expect(
      screen.getByRole('button', { name: new RegExp(es.credentials['options.edit']) }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: new RegExp(es.credentials['options.archive']) }),
    ).toBeVisible();
    first.unmount();

    // EDIT alcanza para editar, no para archivar (exige MANAGE).
    setup({ level: 'EDIT', permissions: ['account.update', 'account.archive'] });
    const second = renderApp(PAGE);
    await rowsLoaded();
    expect(
      screen.getByRole('button', { name: new RegExp(es.credentials['options.edit']) }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: new RegExp(es.credentials['options.archive']) }),
    ).toBeNull();
    second.unmount();

    // Sin permisos de cuenta ni de compartir, el panel no se pinta.
    setup({ level: 'MANAGE', permissions: [] });
    renderApp(PAGE);
    await rowsLoaded();
    expect(options()).toBeNull();
  });

  it('opens the edit dialog of the accounts screen from the detail', async () => {
    const user = userEvent.setup();
    setup({ level: 'EDIT', permissions: ['account.update'] });
    renderApp(PAGE);
    await rowsLoaded();
    await user.click(
      screen.getByRole('button', { name: new RegExp(es.credentials['options.edit']) }),
    );
    expect(await screen.findByRole('dialog')).toBeVisible();
  });
});

describe('shared with', () => {
  const SHARES_PATH = `/accounts/${ACCOUNT_ID}/shares`;
  const sharesRoute = jsonResponse({
    data: [
      {
        id: '66666666-6666-4666-8666-666666666661',
        accountId: ACCOUNT_ID,
        granteeType: 'user',
        granteeId: CREATOR_ID,
        granteeName: 'Diego Torres',
        level: 'USE',
        expiresAt: null,
        grantedBy: CREATOR_ID,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  const panelTitle = () => screen.findByRole('heading', { name: es.credentials['shares.title'] });

  it('lists who the account is shared with for someone who manages it', async () => {
    setup({
      level: 'MANAGE',
      permissions: [...ALL_PERMISSIONS, 'share.manage'],
      extra: { [`GET ${SHARES_PATH}`]: sharesRoute },
    });
    const { container } = renderApp(PAGE);
    await panelTitle();
    expect(await screen.findByText('Diego Torres')).toBeVisible();
    expect(screen.getByText(es.credentials['level.USE'])).toBeVisible();
    expect(screen.getByRole('link', { name: es.credentials['shares.manage'] })).toHaveAttribute(
      'href',
      SHARES_PATH,
    );
    expect(screen.getByRole('link', { name: es.credentials['action.share'] })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  // El servidor exige `share.manage` y MANAGE: sin ambos ni se pide la lista ni se pinta el panel.
  it.each([
    ['MANAGE without share.manage', 'MANAGE', ALL_PERMISSIONS],
    ['share.manage below MANAGE', 'EDIT', [...ALL_PERMISSIONS, 'share.manage']],
  ] as const)('stays hidden and never asks the API: %s', async (_name, level, permissions) => {
    const api = setup({ level, permissions: [...permissions] });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('heading', { name: es.credentials['shares.title'] })).toBeNull();
    expect(screen.queryByRole('link', { name: es.credentials['action.share'] })).toBeNull();
    expect(api.callsTo('GET', SHARES_PATH)).toHaveLength(0);
  });
});

describe('action gating by level and permission', () => {
  const LABEL = 'Portal de nómina';

  it('USE only offers copying the username', async () => {
    setup({ level: 'USE' });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: revealLabel(LABEL) })).toBeNull();
    expect(screen.getByRole('button', { name: copyLabel(LABEL) })).toBeVisible();
    // USE no puede revelar: la fila lo explica en lugar del botón.
    expect(
      screen.getAllByText(
        fill(es.credentials['reveal.notAllowedLevel'], { level: es.credentials['level.USE'] }),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: menuLabel(LABEL) })).toBeNull();
    expect(screen.queryByRole('button', { name: es.credentials['action.create'] })).toBeNull();
  });

  it('VIEW adds reveal, but only with the reveal permission', async () => {
    setup({ level: 'VIEW' });
    const first = renderApp(PAGE);
    await rowsLoaded();
    expect(screen.getByRole('button', { name: revealLabel(LABEL) })).toBeVisible();
    expect(screen.getByRole('button', { name: copyLabel(LABEL) })).toBeVisible();
    // Cambiar contraseña e historial piden EDIT: sin ellos no hay menú.
    expect(screen.queryByRole('button', { name: menuLabel(LABEL) })).toBeNull();
    first.unmount();

    setup({ level: 'VIEW', permissions: [] });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: revealLabel(LABEL) })).toBeNull();
    expect(screen.getAllByText(es.credentials['reveal.notAllowed']).length).toBeGreaterThan(0);
  });

  it('EDIT adds create, change password and history', async () => {
    const user = userEvent.setup();
    setup({ level: 'EDIT' });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.getByRole('button', { name: es.credentials['action.create'] })).toBeVisible();
    expect(screen.getByRole('button', { name: revealLabel(LABEL) })).toBeVisible();
    expect(await rowMenuItemTexts(user, menuLabel(LABEL))).toEqual([
      changePasswordItem,
      historyItem,
    ]);
  });

  it('EDIT without catalog permissions keeps only history and copy', async () => {
    const user = userEvent.setup();
    setup({ level: 'EDIT', permissions: [] });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: es.credentials['action.create'] })).toBeNull();
    expect(screen.queryByRole('button', { name: revealLabel(LABEL) })).toBeNull();
    expect(await rowMenuItemTexts(user, menuLabel(LABEL))).toEqual([historyItem]);
  });

  it('draws no menu when the account level offers no action at all', async () => {
    setup({ level: null, permissions: [] });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: menuLabel(LABEL) })).toBeNull();
    expect(screen.queryByRole('button', { name: copyLabel(LABEL) })).toBeNull();
  });
});

describe('row actions: accessible names and keyboard', () => {
  const LABEL = 'Portal de nómina';

  // WCAG 2.5.3: el nombre accesible empieza con el texto visible (control por voz).
  it('names every visible row control starting with its visible text', async () => {
    setup({ level: 'EDIT' });
    renderApp(PAGE);
    await rowsLoaded();
    const reveal = screen.getByRole('button', { name: revealLabel(LABEL) });
    expect(reveal).toHaveTextContent(es.credentials['action.reveal']);
    expect(revealLabel(LABEL).startsWith(es.credentials['action.reveal'])).toBe(true);
    expect(screen.getByRole('button', { name: menuLabel(LABEL) })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
  });

  it('opens the menu and runs an action with the keyboard only', async () => {
    const user = userEvent.setup();
    setup({ level: 'EDIT' });
    renderApp(PAGE);
    await rowsLoaded();
    const trigger = await waitFor(() => {
      const button = screen.getByRole('button', { name: menuLabel(LABEL) });
      expect(button).toBeEnabled();
      return button;
    });
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: historyItem });
    // Cambiar contraseña, Historial: una flecha llega al historial.
    await user.keyboard('{ArrowDown}{Enter}');
    expect(
      await screen.findByRole('dialog', {
        name: fill(es.credentials['history.title'], { label: LABEL }),
      }),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations with the row menu open', async () => {
    const user = userEvent.setup();
    setup({ level: 'EDIT' });
    renderApp(PAGE);
    await rowsLoaded();
    await openRowMenu(user, menuLabel(LABEL));
    expect(await axeViolations(await screen.findByRole('menu'))).toEqual([]);
  });

  // Hallazgo 21: Radix devolvía el foco al ítem del menú, ya desmontado, y se perdía en <body>.
  it.each([
    ['history dialog closed with Escape', historyItem, 'escape'],
    ['change password dialog closed with its Close button', changePasswordItem, 'button'],
  ])('returns focus to the row menu button: %s', async (_name, item, closeWith) => {
    const user = userEvent.setup();
    setup({
      level: 'EDIT',
      extra: {
        [`GET /credentials/${CREDENTIAL_ID}/history`]: jsonResponse({
          data: [
            {
              version: 1,
              isCurrent: true,
              createdAt: '2026-03-01T12:00:00.000Z',
              createdBy: CREATOR_ID,
            },
          ],
        }),
      },
    });
    renderApp(PAGE);
    await rowsLoaded();
    await chooseRowMenuAction(user, menuLabel(LABEL), item);
    const dialog = await screen.findByRole('dialog');
    if (closeWith === 'escape') {
      await user.keyboard('{Escape}');
    } else {
      await user.click(within(dialog).getByRole('button', { name: es.common['dialog.close'] }));
    }
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: menuLabel(LABEL) })).toHaveFocus();
    });
  });
});

describe('copy username', () => {
  function usernameRoute() {
    return {
      [`POST /credentials/${CREDENTIAL_ID}/username`]: jsonResponse({ username: USERNAME }),
    };
  }

  it('writes the username to the clipboard and clears it after 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const api = setup({ level: 'USE', extra: usernameRoute() });
    const { queryClient } = renderApp(PAGE);
    await rowsLoaded();
    const write = vi.spyOn(navigator.clipboard, 'writeText');

    await user.click(screen.getByRole('button', { name: copyLabel('Portal de nómina') }));
    await waitFor(() => {
      expect(write).toHaveBeenCalledWith(USERNAME);
    });
    expect(api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/username`)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIDE_AFTER_MS + 1_000);
    });
    // El stub de user-event no permite leer un portapapeles vacío: se verifica la escritura.
    expect(write).toHaveBeenLastCalledWith('');
    expectNoSecretsStored(queryClient, [USERNAME]);
  });

  it('does not clear the clipboard when it holds something else by then', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    setup({ level: 'USE', extra: usernameRoute() });
    renderApp(PAGE);
    await rowsLoaded();
    const write = vi.spyOn(navigator.clipboard, 'writeText');

    await user.click(screen.getByRole('button', { name: copyLabel('Portal de nómina') }));
    await waitFor(() => {
      expect(write).toHaveBeenCalledWith(USERNAME);
    });
    await navigator.clipboard.writeText('otra cosa que copió la persona');
    write.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIDE_AFTER_MS + 1_000);
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('shows the translated error when the server denies it', async () => {
    const user = userEvent.setup();
    setup({
      level: 'USE',
      extra: { [`POST /credentials/${CREDENTIAL_ID}/username`]: problem(403, 'AUTHZ.SHARE') },
    });
    renderApp(PAGE);
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: copyLabel('Portal de nómina') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });
});

describe('reveal password', () => {
  const revealPath = `POST /credentials/${CREDENTIAL_ID}/reveal`;
  const revealCalls = (api: ReturnType<typeof setup>) =>
    api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/reveal`);
  const revealedResponse = () => jsonResponse({ password: PASSWORD });

  const dialogName = fill(es.credentials['reveal.title'], { label: 'Portal de nómina' });

  // Un solo clic: la petición sale del clic de la fila y la contraseña aparece sin pasos previos.
  async function clickReveal(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: revealLabel('Portal de nómina') }));
  }

  async function revealWithOneClick(user: ReturnType<typeof userEvent.setup>) {
    await clickReveal(user);
    return screen.findByRole('dialog', { name: dialogName });
  }

  it('shows the password with a single click, asks for no reason and sends no body, without violations', async () => {
    const user = userEvent.setup();
    const api = setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    renderApp(PAGE);
    const dialog = await revealWithOneClick(user);

    expect(await screen.findByDisplayValue(PASSWORD)).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /motivo/i })).toBeNull();
    expect(within(dialog).queryByText(es.credentials['reveal.warning'])).toBeNull();
    const calls = revealCalls(api);
    expect(calls).toHaveLength(1);
    // Sin cuerpo: nada de `reason`, ni siquiera vacío.
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers.has('Content-Type')).toBe(false);
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);
  });

  it('shows an accessible loading state until the response arrives, without violations', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setup({
      level: 'VIEW',
      extra: {
        [revealPath]: async () => {
          await gate;
          return revealedResponse();
        },
      },
    });
    renderApp(PAGE);
    const dialog = await revealWithOneClick(user);

    expect(within(dialog).getByRole('status')).toHaveTextContent(es.credentials['reveal.loading']);
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);

    release();
    expect(await screen.findByDisplayValue(PASSWORD)).toBeInTheDocument();
    expect(within(dialog).queryByText(es.credentials['reveal.loading'])).toBeNull();
  });

  // SENSIBLE (revisión humana): StrictMode ejecuta los efectos dos veces; si la petición saliera de un
  // efecto de montaje se revelaría y auditaría dos veces y contaría doble para el tope por hora.
  it('sends exactly one request per click even under StrictMode', async () => {
    configure({ reactStrictMode: true });
    try {
      const user = userEvent.setup();
      const api = setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
      renderApp(PAGE);
      await revealWithOneClick(user);
      await screen.findByDisplayValue(PASSWORD);
      expect(revealCalls(api)).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: es.credentials['reveal.hideNow'] }));
      await user.click(screen.getByRole('button', { name: es.credentials['reveal.again'] }));
      await screen.findByDisplayValue(PASSWORD);
      expect(revealCalls(api)).toHaveLength(2);
    } finally {
      configure({ reactStrictMode: false });
    }
  });

  // SENSIBLE (revisión humana): cerrar antes de la respuesta descarta la contraseña, no se pinta.
  it('does not show the password when the dialog is closed before the response arrives', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { queryClient } = {
      ...setup({
        level: 'VIEW',
        extra: {
          [revealPath]: async () => {
            await gate;
            return revealedResponse();
          },
        },
      }),
      ...renderApp(PAGE),
    };
    const dialog = await revealWithOneClick(user);
    expect(within(dialog).getByRole('status')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    release();
    // Deja correr la respuesta tardía y su manejo antes de afirmar.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(document.body.textContent).not.toContain(PASSWORD);
    expectNoSecretsStored(queryClient, [PASSWORD]);
  });

  it('shows the hourly limit message in the dialog and blocks retrying', async () => {
    const user = userEvent.setup();
    const api = setup({
      level: 'VIEW',
      extra: { [revealPath]: problem(429, 'CREDENTIAL.REVEAL_LIMIT') },
    });
    renderApp(PAGE);
    const dialog = await revealWithOneClick(user);
    expect(
      await within(dialog).findByText(new RegExp(es.errors['CREDENTIAL.REVEAL_LIMIT'])),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: es.common['actions.retry'] })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: es.common['actions.close'] })).toBeEnabled();
    expect(revealCalls(api)).toHaveLength(1);
  });

  it('shows a 403 in the dialog and lets the person close it and try again with another click', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = setup({
      level: 'VIEW',
      extra: {
        [revealPath]: () => {
          attempts += 1;
          return attempts === 1 ? problem(403, 'AUTHZ.SHARE') : revealedResponse();
        },
      },
    });
    renderApp(PAGE);
    const dialog = await revealWithOneClick(user);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: es.common['actions.close'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await user.click(screen.getByRole('button', { name: revealLabel('Portal de nómina') }));
    expect(await screen.findByDisplayValue(PASSWORD)).toBeInTheDocument();
    expect(revealCalls(api)).toHaveLength(2);
  });

  it('retries from the error with a new click', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = setup({
      level: 'VIEW',
      extra: {
        [revealPath]: () => {
          attempts += 1;
          return attempts === 1 ? problem(500, 'INTERNAL') : revealedResponse();
        },
      },
    });
    renderApp(PAGE);
    const dialog = await revealWithOneClick(user);
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.retry'] }));
    expect(await screen.findByDisplayValue(PASSWORD)).toBeInTheDocument();
    expect(revealCalls(api)).toHaveLength(2);
  });

  it('shows the re-authentication message when the user cancels the identity check', async () => {
    const user = userEvent.setup();
    const api = setup({
      level: 'VIEW',
      extra: { [revealPath]: problem(403, 'AUTHZ.REAUTH_REQUIRED') },
    });
    renderApp(PAGE);
    await clickReveal(user);
    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.click(within(reauth).getByRole('button', { name: es.common['actions.cancel'] }));
    expect(
      await screen.findByText(new RegExp(es.errors['AUTHZ.REAUTH_REQUIRED'])),
    ).toBeInTheDocument();
    expect(revealCalls(api)).toHaveLength(1);
  });

  it('reauthenticates and retries the reveal exactly once, then shows the password', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = setup({
      level: 'VIEW',
      extra: {
        [revealPath]: () => {
          attempts += 1;
          return attempts === 1 ? problem(403, 'AUTHZ.REAUTH_REQUIRED') : revealedResponse();
        },
        'POST /auth/reauth': noContent(),
      },
    });
    renderApp(PAGE);
    await clickReveal(user);
    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(reauth).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '246810',
    );
    await user.click(within(reauth).getByRole('button', { name: es.common['reauth.submit'] }));
    expect(await screen.findByDisplayValue(PASSWORD)).toBeInTheDocument();
    expect(revealCalls(api)).toHaveLength(2);
    expect(revealCalls(api)[1]?.body).toBeUndefined();
    expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(1);
  });

  it('shows the password, hides it after 30 s and leaves no trace in the DOM or the stores', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    const { queryClient } = renderApp(PAGE);
    await revealWithOneClick(user);
    expect(await screen.findByDisplayValue(PASSWORD)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIDE_AFTER_MS - 5_000);
    });
    expect(screen.getByDisplayValue(PASSWORD)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(screen.getByText(es.credentials['reveal.hidden'])).toBeVisible();
    expect(window.location.href).not.toContain(PASSWORD);
    expectNoSecretsStored(queryClient, [PASSWORD]);
  });

  it('hides the password right away with "Hide now"', async () => {
    const user = userEvent.setup();
    setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    renderApp(PAGE);
    await revealWithOneClick(user);
    await screen.findByDisplayValue(PASSWORD);
    await user.click(screen.getByRole('button', { name: es.credentials['reveal.hideNow'] }));
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  // SENSIBLE (revisión humana): al revelar el foco va al aviso de ocultado (no al campo del secreto),
  // ese foco es el único anuncio de la contraseña (sin región de estado) y nada fuera del campo la contiene.
  it('moves focus to the auto-hide notice, with no duplicate live region and no password outside the field', async () => {
    const user = userEvent.setup();
    setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    renderApp(PAGE);
    const dialog = await revealWithOneClick(user);
    const passwordField = await screen.findByDisplayValue(PASSWORD);
    const autoHide = fill(es.credentials['reveal.autoHide'], { seconds: 30 });
    const notice = within(dialog).getByText((content) => content.startsWith(autoHide));
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(passwordField);
    expect(notice).not.toHaveTextContent(PASSWORD);
    expect(notice).not.toHaveAttribute('aria-label');
    expect(notice).not.toHaveAttribute('title');
    expect(announcedStatusTexts(dialog)).toEqual([]);
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  // SENSIBLE (revisión humana): la cuenta regresiva es visible, silenciosa (aria-live="off"), baja
  // cada segundo y solo contiene texto fijo y segundos, nunca la contraseña.
  it('shows a silent visible countdown that ticks every second without the password', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    renderApp(PAGE);
    const dialog = await revealWithOneClick(user);
    await screen.findByDisplayValue(PASSWORD);

    const countdown = within(dialog).getByRole('timer');
    expect(countdown).toBeVisible();
    expect(countdown).toHaveAttribute('aria-live', 'off');
    expect(countdown).not.toHaveTextContent(PASSWORD);
    const secondsOf = () => Number(/\d+/.exec(countdown.textContent)?.[0]);
    // Con reloj simulado el valor es determinista: el ocultado y la cuenta salen del mismo límite.
    expect(secondsOf()).toBe(30);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(secondsOf()).toBe(20);

    // Baja de forma monótona: nunca sube entre dos puntos y nunca es negativa.
    let previousSeconds = secondsOf();
    for (let elapsedSeconds = 11; elapsedSeconds <= 29; elapsedSeconds += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      const currentSeconds = secondsOf();
      expect(currentSeconds).toBe(30 - elapsedSeconds);
      expect(currentSeconds).toBeLessThan(previousSeconds);
      previousSeconds = currentSeconds;
    }

    // Último segundo: llega a 0 sin pasar a negativo y la contraseña se oculta.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(within(dialog).queryByRole('timer')).toBeNull();
  });

  // SENSIBLE (revisión humana): al ocultar a mano el foco va al aviso de oculto, que sigue montado y
  // es el único anuncio (texto fijo, sin región de estado ni alert).
  it('moves focus to the hidden notice when the password is hidden by hand', async () => {
    const user = userEvent.setup();
    setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    renderApp(PAGE);
    const dialog = await revealWithOneClick(user);
    await screen.findByDisplayValue(PASSWORD);
    await user.click(screen.getByRole('button', { name: es.credentials['reveal.hideNow'] }));
    const notice = within(dialog).getByText(es.credentials['reveal.hidden']);
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
    expect(notice).not.toHaveTextContent(PASSWORD);
    expect(within(dialog).queryByRole('status')).toBeNull();
    // El aviso visible no es un role="alert": no repite el anuncio del foco.
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  // SENSIBLE (revisión humana): al expirar solo (30 s) la contraseña sale del DOM y el foco, que
  // estaba en el aviso desmontado, queda en el aviso de oculto y no cae al <body>.
  it('removes the password and keeps focus on the hidden notice when it expires by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    renderApp(PAGE);
    const dialog = await revealWithOneClick(user);
    await screen.findByDisplayValue(PASSWORD);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIDE_AFTER_MS + 1_000);
    });

    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(document.body.textContent).not.toContain(PASSWORD);
    const notice = within(dialog).getByText(es.credentials['reveal.hidden']);
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(within(dialog).queryByRole('timer')).toBeNull();
  });

  it('reveals again with one click after it hides, with a new request and no reason', async () => {
    const user = userEvent.setup();
    const api = setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    renderApp(PAGE);
    await revealWithOneClick(user);
    await screen.findByDisplayValue(PASSWORD);
    await user.click(screen.getByRole('button', { name: es.credentials['reveal.hideNow'] }));
    expect(revealCalls(api)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: es.credentials['reveal.again'] }));
    expect(await screen.findByDisplayValue(PASSWORD)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /motivo/i })).toBeNull();
    const calls = revealCalls(api);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toBeUndefined();
  });

  it('drops the password when the dialog is closed', async () => {
    const user = userEvent.setup();
    const { queryClient } = {
      ...setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } }),
      ...renderApp(PAGE),
    };
    await revealWithOneClick(user);
    await screen.findByDisplayValue(PASSWORD);
    await user.click(screen.getByRole('button', { name: es.common['dialog.close'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(document.body.textContent).not.toContain(PASSWORD);
    expectNoSecretsStored(queryClient, [PASSWORD]);
  });

  it('drops the password when the screen unmounts', async () => {
    const user = userEvent.setup();
    setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    const { unmount } = renderApp(PAGE);
    await revealWithOneClick(user);
    await screen.findByDisplayValue(PASSWORD);
    unmount();
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  it('copies the revealed password and clears the clipboard after 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    setup({ level: 'VIEW', extra: { [revealPath]: revealedResponse() } });
    renderApp(PAGE);
    await revealWithOneClick(user);
    await screen.findByDisplayValue(PASSWORD);
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: es.credentials['reveal.copy'] }));
    await waitFor(() => {
      expect(write).toHaveBeenCalledWith(PASSWORD);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIDE_AFTER_MS + 1_000);
    });
    expect(write).toHaveBeenLastCalledWith('');
  });
});

describe('create credential', () => {
  it('sends label, username and password, then refreshes the list', async () => {
    const user = userEvent.setup();
    let created = false;
    const api = setup({
      level: 'EDIT',
      extra: {
        [`GET /accounts/${ACCOUNT_ID}/credentials`]: () =>
          jsonResponse({ data: created ? [ROTATED, NEVER_ROTATED] : [ROTATED] }),
        [`POST /accounts/${ACCOUNT_ID}/credentials`]: () => {
          created = true;
          return jsonResponse({ ...NEVER_ROTATED, id: NEW_CREDENTIAL_ID }, 201);
        },
      },
    });
    const { queryClient } = renderApp(PAGE);
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.credentials['action.create'] }));
    const dialog = await screen.findByRole('dialog', { name: es.credentials['create.title'] });
    expect(await axeViolations(dialog)).toEqual([]);

    await user.type(field(es.credentials['form.label']), 'Banco');
    await user.type(field(es.credentials['form.username']), USERNAME);
    await user.type(field(es.credentials['form.password']), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['create.submit'] }));

    expect(
      await screen.findByText(fill(es.credentials['create.toast'], { label: 'Banco' })),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `/accounts/${ACCOUNT_ID}/credentials`)[0]?.body).toEqual({
      label: 'Banco',
      username: USERNAME,
      password: PASSWORD,
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('heading', { level: 3, name: 'Banco' })).toBeInTheDocument();
    });
    expectNoSecretsStored(queryClient, [PASSWORD, USERNAME]);
  });

  it('requires the three fields and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ level: 'EDIT' });
    renderApp(PAGE);
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.credentials['action.create'] }));
    const dialog = await screen.findByRole('dialog', { name: es.credentials['create.title'] });
    await user.click(within(dialog).getByRole('button', { name: es.credentials['create.submit'] }));
    const alerts = await within(dialog).findAllByRole('alert');
    expect(alerts).toHaveLength(3);
    expect(api.callsTo('POST', `/accounts/${ACCOUNT_ID}/credentials`)).toHaveLength(0);
  });

  it('shows AUTHZ.SHARE (403) in the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    setup({
      level: 'EDIT',
      extra: { [`POST /accounts/${ACCOUNT_ID}/credentials`]: problem(403, 'AUTHZ.SHARE') },
    });
    renderApp(PAGE);
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: es.credentials['action.create'] }));
    const dialog = await screen.findByRole('dialog', { name: es.credentials['create.title'] });
    await user.type(field(es.credentials['form.label']), 'Banco');
    await user.type(field(es.credentials['form.username']), USERNAME);
    await user.type(field(es.credentials['form.password']), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['create.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });
});

describe('change password', () => {
  it('sends only the new password and refreshes the list', async () => {
    const user = userEvent.setup();
    const api = setup({
      level: 'EDIT',
      extra: {
        [`POST /credentials/${CREDENTIAL_ID}/password`]: jsonResponse({
          ...ROTATED,
          lastRotatedAt: '2026-10-28T12:00:00.000Z',
        }),
      },
    });
    const { queryClient } = renderApp(PAGE);
    await rowsLoaded();
    const before = api.callsTo('GET', `/accounts/${ACCOUNT_ID}/credentials`).length;
    await chooseRowMenuAction(user, menuLabel('Portal de nómina'), changePasswordItem);
    const dialog = await screen.findByRole('dialog', {
      name: fill(es.credentials['password.title'], { label: 'Portal de nómina' }),
    });
    expect(await axeViolations(dialog)).toEqual([]);
    await user.type(field(es.credentials['form.newPassword']), PASSWORD);
    await user.click(
      within(dialog).getByRole('button', { name: es.credentials['password.submit'] }),
    );

    expect(
      await screen.findByText(
        fill(es.credentials['password.toast'], { label: 'Portal de nómina' }),
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/password`)[0]?.body).toEqual({
      password: PASSWORD,
    });
    await waitFor(() => {
      expect(api.callsTo('GET', `/accounts/${ACCOUNT_ID}/credentials`).length).toBeGreaterThan(
        before,
      );
    });
    expectNoSecretsStored(queryClient, [PASSWORD]);
  });

  it('requires a password and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ level: 'EDIT' });
    renderApp(PAGE);
    await rowsLoaded();
    await chooseRowMenuAction(user, menuLabel('Portal de nómina'), changePasswordItem);
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: es.credentials['password.submit'] }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.common['validation.required'],
    );
    expect(api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/password`)).toHaveLength(0);
  });
});

describe('history', () => {
  it('lists versions with their state and no secret content', async () => {
    const user = userEvent.setup();
    setup({
      level: 'EDIT',
      extra: {
        [`GET /credentials/${CREDENTIAL_ID}/history`]: jsonResponse({
          data: [
            {
              version: 2,
              isCurrent: true,
              createdAt: '2026-03-01T12:00:00.000Z',
              createdBy: CREATOR_ID,
            },
            {
              version: 1,
              isCurrent: false,
              createdAt: '2026-01-01T12:00:00.000Z',
              createdBy: CREATOR_ID,
            },
          ],
        }),
      },
    });
    renderApp(PAGE);
    await rowsLoaded();
    await chooseRowMenuAction(user, menuLabel('Portal de nómina'), historyItem);
    const dialog = await screen.findByRole('dialog', {
      name: fill(es.credentials['history.title'], { label: 'Portal de nómina' }),
    });
    expect(await within(dialog).findByText(es.credentials['history.current'])).toBeVisible();
    // Se acota a la tabla: el paginador, siempre visible, también tiene un botón "Anterior".
    expect(
      within(within(dialog).getByRole('table')).getByText(es.credentials['history.previous']),
    ).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('shows a translated error when the history is denied', async () => {
    const user = userEvent.setup();
    setup({
      level: 'EDIT',
      extra: { [`GET /credentials/${CREDENTIAL_ID}/history`]: problem(403, 'AUTHZ.SHARE') },
    });
    renderApp(PAGE);
    await rowsLoaded();
    await chooseRowMenuAction(user, menuLabel('Portal de nómina'), historyItem);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });
});

describe('restore a password version', () => {
  const HISTORY_PATH = `/credentials/${CREDENTIAL_ID}/history`;
  const RESTORE_PATH = `/credentials/${CREDENTIAL_ID}/versions/1/restore`;
  const historyRoute = jsonResponse({
    data: [
      { version: 2, isCurrent: true, createdAt: '2026-03-01T12:00:00.000Z', createdBy: CREATOR_ID },
      {
        version: 1,
        isCurrent: false,
        createdAt: '2026-01-01T12:00:00.000Z',
        createdBy: CREATOR_ID,
      },
    ],
  });
  const restoreLabel = (version: number) =>
    fill(es.credentials['history.restore.label'], { version });

  async function openHistory(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await chooseRowMenuAction(user, menuLabel('Portal de nómina'), historyItem);
    const dialog = await screen.findByRole('dialog', {
      name: fill(es.credentials['history.title'], { label: 'Portal de nómina' }),
    });
    await within(dialog).findByText(es.credentials['history.current']);
    return dialog;
  }

  async function openRestoreConfirmation(user: ReturnType<typeof userEvent.setup>) {
    const history = await openHistory(user);
    await user.click(within(history).getByRole('button', { name: restoreLabel(1) }));
    return screen.findByRole('dialog', {
      name: fill(es.credentials['history.restore.title'], { version: 1 }),
    });
  }

  it('offers restore only on previous versions, never on the current one', async () => {
    const user = userEvent.setup();
    setup({ level: 'EDIT', extra: { [`GET ${HISTORY_PATH}`]: historyRoute } });
    renderApp(PAGE);
    const dialog = await openHistory(user);
    expect(within(dialog).getByRole('button', { name: restoreLabel(1) })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: restoreLabel(2) })).toBeNull();
    expect(within(dialog).getAllByRole('button', { name: /^Restaurar la versión/ })).toHaveLength(
      1,
    );
  });

  // SENSIBLE (revisión humana): la visibilidad del botón sigue el permiso propio, no `credential.update`.
  it('hides restore from a person who can change the password but lacks credential.restore_version', async () => {
    const user = userEvent.setup();
    setup({
      level: 'EDIT',
      permissions: ['credential.update', 'credential.reveal_password'],
      extra: { [`GET ${HISTORY_PATH}`]: historyRoute },
    });
    renderApp(PAGE);
    const dialog = await openHistory(user);
    expect(within(dialog).queryByRole('button', { name: /^Restaurar la versión/ })).toBeNull();
  });

  // SENSIBLE (revisión humana): con solo el permiso de restaurar, el botón aparece.
  it('offers restore with only credential.restore_version', async () => {
    const user = userEvent.setup();
    setup({
      level: 'EDIT',
      permissions: ['credential.restore_version'],
      extra: { [`GET ${HISTORY_PATH}`]: historyRoute },
    });
    renderApp(PAGE);
    const dialog = await openHistory(user);
    expect(within(dialog).getByRole('button', { name: restoreLabel(1) })).toBeVisible();
  });

  it('restores the chosen version, reloads the queries and confirms without storing the password', async () => {
    const user = userEvent.setup();
    const api = setup({
      level: 'EDIT',
      extra: {
        [`GET ${HISTORY_PATH}`]: historyRoute,
        [`POST ${RESTORE_PATH}`]: jsonResponse({
          ...ROTATED,
          lastRotatedAt: '2026-10-28T12:00:00.000Z',
        }),
      },
    });
    const { queryClient } = renderApp(PAGE);
    const confirmation = await openRestoreConfirmation(user);
    expect(
      within(confirmation).getByText(
        fill(es.credentials['history.restore.description'], { version: 1 }),
      ),
    ).toBeVisible();
    const historyCallsBefore = api.callsTo('GET', HISTORY_PATH).length;
    const listCallsBefore = api.callsTo('GET', `/accounts/${ACCOUNT_ID}/credentials`).length;

    await user.click(
      within(confirmation).getByRole('button', { name: es.credentials['history.restore.confirm'] }),
    );

    expect(
      await screen.findByText(fill(es.credentials['history.restore.done'], { version: 1 })),
    ).toBeVisible();
    expect(api.callsTo('POST', RESTORE_PATH)).toHaveLength(1);
    await waitFor(() => {
      expect(api.callsTo('GET', HISTORY_PATH).length).toBeGreaterThan(historyCallsBefore);
      expect(api.callsTo('GET', `/accounts/${ACCOUNT_ID}/credentials`).length).toBeGreaterThan(
        listCallsBefore,
      );
    });
    expectNoSecretsStored(queryClient, [PASSWORD]);
  });

  // SENSIBLE (revisión humana): sin permiso o nivel el servidor niega y la pantalla lo muestra traducido.
  it('shows a translated error when restoring is denied (403)', async () => {
    const user = userEvent.setup();
    const api = setup({
      level: 'EDIT',
      extra: {
        [`GET ${HISTORY_PATH}`]: historyRoute,
        [`POST ${RESTORE_PATH}`]: problem(403, 'AUTHZ.SHARE'),
      },
    });
    renderApp(PAGE);
    const confirmation = await openRestoreConfirmation(user);
    await user.click(
      within(confirmation).getByRole('button', { name: es.credentials['history.restore.confirm'] }),
    );
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.SHARE'],
    );
    expect(api.callsTo('POST', RESTORE_PATH)).toHaveLength(1);
    expect(
      screen.queryByText(fill(es.credentials['history.restore.done'], { version: 1 })),
    ).toBeNull();
  });

  // SENSIBLE (revisión humana): restaurar la versión que ya es la vigente se rechaza con 409.
  it('shows a translated error when the version is already current (409)', async () => {
    const user = userEvent.setup();
    setup({
      level: 'EDIT',
      extra: {
        [`GET ${HISTORY_PATH}`]: historyRoute,
        [`POST ${RESTORE_PATH}`]: problem(409, 'CREDENTIAL.VERSION_ALREADY_CURRENT'),
      },
    });
    renderApp(PAGE);
    const confirmation = await openRestoreConfirmation(user);
    await user.click(
      within(confirmation).getByRole('button', { name: es.credentials['history.restore.confirm'] }),
    );
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent(
      es.errors['CREDENTIAL.VERSION_ALREADY_CURRENT'],
    );
  });

  it('disables the confirm button during a 429 and sends nothing more', async () => {
    const user = userEvent.setup();
    const api = setup({
      level: 'EDIT',
      extra: {
        [`GET ${HISTORY_PATH}`]: historyRoute,
        [`POST ${RESTORE_PATH}`]: problem(429, 'RATE_LIMITED', { headers: { 'Retry-After': '7' } }),
      },
    });
    renderApp(PAGE);
    const confirmation = await openRestoreConfirmation(user);
    await user.click(
      within(confirmation).getByRole('button', { name: es.credentials['history.restore.confirm'] }),
    );
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent(
      es.errors['RATE_LIMITED'],
    );
    expect(
      within(confirmation).getByRole('button', { name: es.credentials['history.restore.confirm'] }),
    ).toBeDisabled();
    expect(api.callsTo('POST', RESTORE_PATH)).toHaveLength(1);
  });
});

describe('credentials screen in English', () => {
  it('renders in English too', async () => {
    const { loadCredentialsCatalog } = await import('@iam/i18n');
    const en = (await loadCredentialsCatalog())['en-US'];
    setup();
    renderApp(PAGE, 'en-US');
    expect(await screen.findByRole('list', { name: en.caption })).toBeInTheDocument();
    await rowsLoaded();
    expect(screen.getAllByText(en['kind.password']).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', {
        name: en['action.copyUsernameLabel'].replace('{{label}}', ROTATED.label),
      }),
    ).toBeVisible();
  });
});

// WCAG 2.5.3: con control por voz se dice el texto visible, así que el nombre accesible debe
// empezar con él. Se comprueba en las plantillas de ambos idiomas.
describe('accessible names start with the visible text, in both languages', () => {
  it.each(['es-MX', 'en-US'] as const)('%s', async (locale) => {
    const { loadAccountsCatalog, loadCredentialsCatalog, loadSharesCatalog } =
      await import('@iam/i18n');
    const credentials = (await loadCredentialsCatalog())[locale];
    const accounts = (await loadAccountsCatalog())[locale];
    const shares = (await loadSharesCatalog())[locale];
    const pairs: [visible: string, accessible: string][] = [
      [credentials['action.reveal'], credentials['action.revealLabel']],
      [credentials['action.copy'], credentials['action.copyUsernameLabel']],
      [credentials['action.totp'], credentials['action.totpLabel']],
      [accounts['action.credentials'], accounts['action.credentialsLabel']],
      [accounts['action.share'], accounts['action.shareLabel']],
      [accounts['action.edit'], accounts['action.editLabel']],
      [accounts['action.archive'], accounts['action.archiveLabel']],
      [shares['action.revoke'], shares['action.revokeLabel']],
      [credentials['history.restore.action'], credentials['history.restore.label']],
    ];
    for (const [visible, accessible] of pairs) {
      expect(accessible.startsWith(visible), `${accessible} must start with ${visible}`).toBe(true);
    }
    expect(credentials['action.rowMenu']).toContain('{{label}}');
  });
});
