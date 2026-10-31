import type { Account, Credential, Permission, ShareLevel } from '@iam/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
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
const REASON = 'Recuperar acceso tras cambio de dispositivo';
const HIDE_AFTER_MS = 30_000;

const ALL_PERMISSIONS: Permission[] = [
  'credential.create',
  'credential.update',
  'credential.restore_version',
  'credential.reveal_password',
];

const accountFixture = (myLevel: ShareLevel | null): Account => ({
  id: ACCOUNT_ID,
  platformId: PLATFORM_ID,
  displayName: 'Nómina',
  handle: null,
  ownerGroupId: null,
  tags: [],
  status: 'active',
  myLevel,
  createdAt: '2026-01-01T00:00:00.000Z',
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
const copyUsernameItem = es.credentials['action.copyUsername'];
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
const rowsLoaded = () => screen.findByRole('cell', { name: ROTATED.label });

afterEach(() => {
  vi.useRealTimers();
});

describe('credentials list', () => {
  it('lists label, kind and last rotation, without violations', async () => {
    setup();
    const { container } = renderApp(PAGE);
    await rowsLoaded();
    const table = screen.getByRole('table', { name: es.credentials.caption });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([
        es.credentials['col.label'],
        es.credentials['col.kind'],
        es.credentials['col.lastRotated'],
      ]),
    );
    expect(within(table).getByText(es.credentials['kind.password'])).toBeInTheDocument();
    expect(within(table).getByText(es.credentials['kind.password_totp'])).toBeInTheDocument();
    expect(within(table).getByText(es.credentials['rotated.never'])).toBeInTheDocument();
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

describe('action gating by level and permission', () => {
  const LABEL = 'Portal de nómina';

  it('USE only offers copying the username', async () => {
    const user = userEvent.setup();
    setup({ level: 'USE' });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: revealLabel(LABEL) })).toBeNull();
    expect(await rowMenuItemTexts(user, menuLabel(LABEL))).toEqual([copyUsernameItem]);
    expect(screen.queryByRole('button', { name: es.credentials['action.create'] })).toBeNull();
  });

  it('VIEW adds reveal as the visible primary action, but only with the reveal permission', async () => {
    const user = userEvent.setup();
    setup({ level: 'VIEW' });
    const first = renderApp(PAGE);
    await rowsLoaded();
    expect(screen.getByRole('button', { name: revealLabel(LABEL) })).toBeVisible();
    // Revelar es la única acción fuera del menú: el resto no se ofrece como botones sueltos.
    expect(screen.queryByRole('button', { name: copyUsernameItem })).toBeNull();
    expect(await rowMenuItemTexts(user, menuLabel(LABEL))).toEqual([copyUsernameItem]);
    first.unmount();

    setup({ level: 'VIEW', permissions: [] });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: revealLabel(LABEL) })).toBeNull();
    expect(await rowMenuItemTexts(user, menuLabel(LABEL))).toEqual([copyUsernameItem]);
  });

  it('EDIT adds create, change password and history', async () => {
    const user = userEvent.setup();
    setup({ level: 'EDIT' });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.getByRole('button', { name: es.credentials['action.create'] })).toBeVisible();
    expect(screen.getByRole('button', { name: revealLabel(LABEL) })).toBeVisible();
    expect(await rowMenuItemTexts(user, menuLabel(LABEL))).toEqual([
      copyUsernameItem,
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
    expect(await rowMenuItemTexts(user, menuLabel(LABEL))).toEqual([copyUsernameItem, historyItem]);
  });

  it('draws no menu when the account level offers no action at all', async () => {
    setup({ level: null, permissions: [] });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: menuLabel(LABEL) })).toBeNull();
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
    // Copiar usuario, Cambiar contraseña, Historial: dos flechas llegan al historial.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
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

    await chooseRowMenuAction(user, menuLabel('Portal de nómina'), copyUsernameItem);
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

    await chooseRowMenuAction(user, menuLabel('Portal de nómina'), copyUsernameItem);
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
    await chooseRowMenuAction(user, menuLabel('Portal de nómina'), copyUsernameItem);
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });
});

describe('reveal password', () => {
  const revealPath = `POST /credentials/${CREDENTIAL_ID}/reveal`;

  async function openReveal(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: revealLabel('Portal de nómina') }));
    return screen.findByRole('dialog', {
      name: fill(es.credentials['reveal.title'], { label: 'Portal de nómina' }),
    });
  }

  it('asks for a reason with a warning and a live counter, without violations', async () => {
    const user = userEvent.setup();
    setup({ level: 'VIEW' });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    expect(within(dialog).getByText(es.credentials['reveal.warning'])).toBeVisible();
    const counter = (length: number) =>
      fill(es.credentials['reveal.counter'], { length, max: 500, min: 6 });
    expect(within(dialog).getByText(counter(0))).toBeVisible();
    await user.type(field(es.credentials['reveal.reason']), '  abc  ');
    // El contador cuenta como el servidor: sin los espacios de los extremos.
    expect(within(dialog).getByText(counter(3))).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('rejects a reason shorter than 6 characters and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ level: 'VIEW' });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), 'corto');
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
    expect(await within(dialog).findByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeVisible();
    expect(field(es.credentials['reveal.reason'])).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/reveal`)).toHaveLength(0);
  });

  it('rejects a reason made only of spaces', async () => {
    const user = userEvent.setup();
    const api = setup({ level: 'VIEW' });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), '          ');
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
    expect(await within(dialog).findByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeVisible();
    expect(api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/reveal`)).toHaveLength(0);
  });

  it('caps the reason at 500 characters', async () => {
    const user = userEvent.setup();
    setup({ level: 'VIEW' });
    renderApp(PAGE);
    await openReveal(user);
    expect(field(es.credentials['reveal.reason'])).toHaveAttribute('maxlength', '500');
  });

  it('maps a server-side CREDENTIAL.REASON_INVALID to the reason field', async () => {
    const user = userEvent.setup();
    setup({ level: 'VIEW', extra: { [revealPath]: problem(422, 'CREDENTIAL.REASON_INVALID') } });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
    await waitFor(() => {
      expect(field(es.credentials['reveal.reason'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(dialog).getByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeVisible();
  });

  it('shows the hourly limit message and blocks further attempts', async () => {
    const user = userEvent.setup();
    const api = setup({
      level: 'VIEW',
      extra: { [revealPath]: problem(429, 'CREDENTIAL.REVEAL_LIMIT') },
    });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
    expect(
      await within(dialog).findByText(new RegExp(es.errors['CREDENTIAL.REVEAL_LIMIT'])),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }),
    ).toBeDisabled();
    expect(api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/reveal`)).toHaveLength(1);
  });

  it('shows the re-authentication message when the user cancels the identity check', async () => {
    const user = userEvent.setup();
    const api = setup({
      level: 'VIEW',
      extra: { [revealPath]: problem(403, 'AUTHZ.REAUTH_REQUIRED') },
    });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.click(within(reauth).getByRole('button', { name: es.common['actions.cancel'] }));
    expect(
      await screen.findByText(new RegExp(es.errors['AUTHZ.REAUTH_REQUIRED'])),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/reveal`)).toHaveLength(1);
  });

  it('shows the password, hides it after 30 s and leaves no trace in the DOM or the stores', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const api = setup({
      level: 'VIEW',
      extra: { [revealPath]: jsonResponse({ password: PASSWORD }) },
    });
    const { queryClient } = renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), `  ${REASON}  `);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));

    expect(await screen.findByDisplayValue(PASSWORD)).toBeInTheDocument();
    expect(api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/reveal`)[0]?.body).toEqual({
      reason: REASON,
    });
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);

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
    setup({ level: 'VIEW', extra: { [revealPath]: jsonResponse({ password: PASSWORD }) } });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
    await screen.findByDisplayValue(PASSWORD);
    await user.click(screen.getByRole('button', { name: es.credentials['reveal.hideNow'] }));
    expect(screen.queryByDisplayValue(PASSWORD)).toBeNull();
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  // SENSIBLE (revisión humana): al revelar el foco va al aviso de ocultado (no al campo del secreto),
  // ese foco es el único anuncio (sin región de estado) y nada fuera del campo contiene la contraseña.
  it('moves focus to the auto-hide notice, with no duplicate live region and no password outside the field', async () => {
    const user = userEvent.setup();
    setup({ level: 'VIEW', extra: { [revealPath]: jsonResponse({ password: PASSWORD }) } });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
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
    setup({ level: 'VIEW', extra: { [revealPath]: jsonResponse({ password: PASSWORD }) } });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
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
    setup({ level: 'VIEW', extra: { [revealPath]: jsonResponse({ password: PASSWORD }) } });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
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
    await user.click(screen.getByRole('button', { name: es.credentials['reveal.again'] }));
    expect(field(es.credentials['reveal.reason'])).toHaveFocus();
  });

  // SENSIBLE (revisión humana): al expirar solo (30 s) la contraseña sale del DOM y el foco, que
  // estaba en el aviso desmontado, queda en el aviso de oculto y no cae al <body>.
  it('removes the password and keeps focus on the hidden notice when it expires by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    setup({ level: 'VIEW', extra: { [revealPath]: jsonResponse({ password: PASSWORD }) } });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
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

  it('asks for a new reason to reveal again', async () => {
    const user = userEvent.setup();
    const api = setup({
      level: 'VIEW',
      extra: { [revealPath]: jsonResponse({ password: PASSWORD }) },
    });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
    await screen.findByDisplayValue(PASSWORD);
    await user.click(screen.getByRole('button', { name: es.credentials['reveal.hideNow'] }));
    await user.click(screen.getByRole('button', { name: es.credentials['reveal.again'] }));
    expect(field(es.credentials['reveal.reason'])).toHaveValue('');
    expect(api.callsTo('POST', `/credentials/${CREDENTIAL_ID}/reveal`)).toHaveLength(1);
  });

  it('drops the password when the dialog is closed', async () => {
    const user = userEvent.setup();
    const { queryClient } = {
      ...setup({ level: 'VIEW', extra: { [revealPath]: jsonResponse({ password: PASSWORD }) } }),
      ...renderApp(PAGE),
    };
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
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
    setup({ level: 'VIEW', extra: { [revealPath]: jsonResponse({ password: PASSWORD }) } });
    const { unmount } = renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
    await screen.findByDisplayValue(PASSWORD);
    unmount();
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  it('copies the revealed password and clears the clipboard after 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    setup({ level: 'VIEW', extra: { [revealPath]: jsonResponse({ password: PASSWORD }) } });
    renderApp(PAGE);
    const dialog = await openReveal(user);
    await user.type(field(es.credentials['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: es.credentials['reveal.submit'] }));
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
      expect(screen.getByRole('cell', { name: 'Banco' })).toBeInTheDocument();
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
    expect(await screen.findByRole('table', { name: en.caption })).toBeInTheDocument();
    await rowsLoaded();
    expect(screen.getByText(en['kind.password'])).toBeInTheDocument();
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
