import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emitSessionExpired, reauthCoordinator } from '../api';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const lib = vi.hoisted(() => ({ startAuthentication: vi.fn() }));

vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: lib.startAuthentication }));

const PASSKEY_OPTIONS = { challenge: 'challenge-abc', rpId: 'localhost', allowCredentials: [] };
const PASSKEY_ASSERTION = {
  id: 'cred-1',
  type: 'public-key',
  response: { signature: 'SIGNATURE-SECRET' },
};
const PASSKEY_LIST = {
  data: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Laptop',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
    },
  ],
};

beforeEach(() => {
  lib.startAuthentication.mockReset();
});

const CREATED = jsonResponse(
  {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'nuevo@example.com',
    rank: 3,
    expiresAt: '2030-01-04T12:00:00.000Z',
  },
  201,
);

/** Abre el diálogo de invitar y envía el formulario: la operación sensible de estas pruebas. */
async function submitInvitation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: es.directory['users.invite'] }));
  const dialog = await screen.findByRole('dialog', { name: es.directory['invite.title'] });
  await user.type(field(es.directory['invite.email']), 'nuevo@example.com');
  await user.click(within(dialog).getByRole('button', { name: es.directory['invite.submit'] }));
}

function baseRoutes() {
  return {
    'GET /me': jsonResponse(meFixture({ permissions: ['user.invite'] })),
    'GET /users': jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
  };
}

describe('step-up reauthentication', () => {
  it('opens the dialog on AUTHZ.REAUTH_REQUIRED, reauthenticates and retries the operation once', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = stubApi({
      ...baseRoutes(),
      'POST /invitations': () => {
        attempts += 1;
        return attempts === 1 ? problem(403, 'AUTHZ.REAUTH_REQUIRED') : CREATED.clone();
      },
      'POST /auth/reauth': noContent(),
    });
    const { queryClient } = renderApp('/users');
    await submitInvitation(user);

    const dialog = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    expect(await axeViolations(document.body)).toEqual([]);
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '246810'.slice(0, 6),
    );
    await user.click(within(dialog).getByRole('button', { name: es.common['reauth.submit'] }));

    expect(await screen.findByText('Invitación enviada a nuevo@example.com.')).toBeInTheDocument();
    expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(1);
    expect(api.callsTo('POST', '/auth/reauth')[0]?.body).toEqual({ code: '246810' });
    const invitations = api.callsTo('POST', '/invitations');
    expect(invitations).toHaveLength(2);
    // Es la MISMA operación: la clave de idempotencia no cambia entre intento y reintento.
    expect(invitations[1]?.headers.get('Idempotency-Key')).toBe(
      invitations[0]?.headers.get('Idempotency-Key'),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: es.common['reauth.title'] }),
      ).not.toBeInTheDocument();
    });
    expectNoSecretsStored(queryClient, ['246810']);
  });

  it('retries only once: a second REAUTH_REQUIRED is shown as an error, with no new dialog', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      ...baseRoutes(),
      'POST /invitations': () => problem(403, 'AUTHZ.REAUTH_REQUIRED'),
      'POST /auth/reauth': noContent(),
    });
    renderApp('/users');
    await submitInvitation(user);
    const dialog = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${es.common['reauth.code']}`)),
      '123456',
    );
    await user.click(within(dialog).getByRole('button', { name: es.common['reauth.submit'] }));

    await waitFor(() => {
      expect(api.callsTo('POST', '/invitations')).toHaveLength(2);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: es.common['reauth.title'] }),
      ).not.toBeInTheDocument();
    });
    expect(
      await screen.findByText(new RegExp(es.errors['AUTHZ.REAUTH_REQUIRED'])),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(1);
  });

  it('does not retry when the user cancels, and shows the original error', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      ...baseRoutes(),
      'POST /invitations': () => problem(403, 'AUTHZ.REAUTH_REQUIRED'),
    });
    renderApp('/users');
    await submitInvitation(user);
    const dialog = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));

    expect(
      await screen.findByText(new RegExp(es.errors['AUTHZ.REAUTH_REQUIRED'])),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/invitations')).toHaveLength(1);
    expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(0);
  });

  it('keeps the dialog open with a translated error when the code is wrong', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = stubApi({
      ...baseRoutes(),
      'POST /invitations': () => {
        attempts += 1;
        return attempts === 1 ? problem(403, 'AUTHZ.REAUTH_REQUIRED') : CREATED.clone();
      },
      'POST /auth/reauth': ({ body }) =>
        (body as { code: string }).code === '111111'
          ? problem(401, 'AUTH.MFA_INVALID')
          : noContent(),
    });
    const { router } = renderApp('/users');
    await submitInvitation(user);
    const dialog = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    const code = within(dialog).getByLabelText(new RegExp(`^${es.common['reauth.code']}`));

    await user.type(code, '111111');
    await user.click(within(dialog).getByRole('button', { name: es.common['reauth.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['AUTH.MFA_INVALID'],
    );
    // Un código incorrecto no es "sesión expirada": no hay redirección y el diálogo sigue abierto.
    expect(router.state.location.pathname).toBe('/users');
    expect(api.callsTo('POST', '/invitations')).toHaveLength(1);

    await user.clear(code);
    await user.type(code, '222222');
    await user.click(within(dialog).getByRole('button', { name: es.common['reauth.submit'] }));
    expect(await screen.findByText('Invitación enviada a nuevo@example.com.')).toBeInTheDocument();
    expect(api.callsTo('POST', '/invitations')).toHaveLength(2);
  });

  it('can resubmit after cancelling an in-flight code, and the late result frees nothing else', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const lateReauth: { release: () => void } = { release: () => undefined };
    let reauthCalls = 0;
    const api = stubApi({
      ...baseRoutes(),
      'POST /invitations': () => {
        attempts += 1;
        // Intentos 1 y 2 piden reautenticar; el 3.º (reintento tras éxito) crea la invitación.
        return attempts <= 2 ? problem(403, 'AUTHZ.REAUTH_REQUIRED') : CREATED.clone();
      },
      'POST /auth/reauth': () => {
        reauthCalls += 1;
        if (reauthCalls === 1) {
          return new Promise<Response>((resolve) => {
            lateReauth.release = () => {
              resolve(noContent());
            };
          });
        }
        return noContent();
      },
    });
    renderApp('/users');
    await submitInvitation(user);
    let dialog = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    const codeLabel = new RegExp(`^${es.common['reauth.code']}`);
    await user.type(within(dialog).getByLabelText(codeLabel), '111111');
    await user.click(within(dialog).getByRole('button', { name: es.common['reauth.submit'] }));
    await waitFor(() => {
      expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(1);
    });
    // Cancela con el envío en vuelo: la operación original falla con su error.
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: es.common['reauth.title'] }),
      ).not.toBeInTheDocument();
    });

    // Segunda operación: abre una solicitud NUEVA.
    const inviteDialog = await screen.findByRole('dialog', { name: es.directory['invite.title'] });
    await user.click(
      within(inviteDialog).getByRole('button', { name: es.directory['invite.submit'] }),
    );
    dialog = await screen.findByRole('dialog', { name: es.common['reauth.title'] });

    // El resultado tardío de la solicitud cancelada NO libera a la nueva.
    await act(async () => {
      lateReauth.release();
      await Promise.resolve();
    });
    expect(screen.getByRole('dialog', { name: es.common['reauth.title'] })).toBeInTheDocument();
    expect(api.callsTo('POST', '/invitations')).toHaveLength(2);

    // Y se puede volver a enviar: no hay "Action already in progress" silencioso.
    await user.type(within(dialog).getByLabelText(codeLabel), '222222');
    await user.click(within(dialog).getByRole('button', { name: es.common['reauth.submit'] }));
    expect(await screen.findByText('Invitación enviada a nuevo@example.com.')).toBeInTheDocument();
    expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(2);
  });

  it('closes the dialog and rejects the pending operation when the session expires', async () => {
    const user = userEvent.setup();
    stubApi({
      ...baseRoutes(),
      'POST /invitations': () => problem(403, 'AUTHZ.REAUTH_REQUIRED'),
    });
    renderApp('/users');
    await submitInvitation(user);
    await screen.findByRole('dialog', { name: es.common['reauth.title'] });

    act(() => {
      emitSessionExpired();
    });

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: es.common['reauth.title'] }),
      ).not.toBeInTheDocument();
    });
    // La solicitud pendiente se rechazó: nada queda colgado esperando al diálogo.
    expect(reauthCoordinator.isOpen()).toBe(false);
  });

  describe('with a passkey', () => {
    it('offers the passkey, reauthenticates with it and retries the operation once', async () => {
      const user = userEvent.setup();
      lib.startAuthentication.mockResolvedValue(PASSKEY_ASSERTION);
      let attempts = 0;
      const api = stubApi({
        ...baseRoutes(),
        'GET /me/passkeys': jsonResponse(PASSKEY_LIST),
        'POST /invitations': () => {
          attempts += 1;
          return attempts === 1 ? problem(403, 'AUTHZ.REAUTH_REQUIRED') : CREATED.clone();
        },
        'POST /auth/reauth/passkey/options': jsonResponse(PASSKEY_OPTIONS),
        'POST /auth/reauth/passkey/verify': noContent(),
      });
      renderApp('/users');
      await submitInvitation(user);

      const dialog = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
      await user.click(
        await within(dialog).findByRole('button', { name: es.common['reauth.passkey'] }),
      );

      expect(
        await screen.findByText('Invitación enviada a nuevo@example.com.'),
      ).toBeInTheDocument();
      expect(lib.startAuthentication).toHaveBeenCalledWith({ optionsJSON: PASSKEY_OPTIONS });
      expect(api.callsTo('POST', '/auth/reauth/passkey/verify')[0]?.body).toEqual({
        response: PASSKEY_ASSERTION,
      });
      expect(api.callsTo('POST', '/auth/reauth')).toHaveLength(0);
      expect(api.callsTo('POST', '/invitations')).toHaveLength(2);
    });

    it('keeps the dialog open when the person dismisses the browser prompt', async () => {
      const user = userEvent.setup();
      lib.startAuthentication.mockRejectedValue(
        Object.assign(new Error('dismissed'), { name: 'NotAllowedError' }),
      );
      const api = stubApi({
        ...baseRoutes(),
        'GET /me/passkeys': jsonResponse(PASSKEY_LIST),
        'POST /invitations': problem(403, 'AUTHZ.REAUTH_REQUIRED'),
        'POST /auth/reauth/passkey/options': jsonResponse(PASSKEY_OPTIONS),
      });
      renderApp('/users');
      await submitInvitation(user);

      const dialog = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
      await user.click(
        await within(dialog).findByRole('button', { name: es.common['reauth.passkey'] }),
      );

      await waitFor(() => {
        expect(lib.startAuthentication).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByRole('dialog', { name: es.common['reauth.title'] })).toBeInTheDocument();
      expect(api.callsTo('POST', '/auth/reauth/passkey/verify')).toHaveLength(0);
      expect(api.callsTo('POST', '/invitations')).toHaveLength(1);
    });

    it('does not offer the passkey to someone who has none', async () => {
      const user = userEvent.setup();
      const api = stubApi({
        ...baseRoutes(),
        'GET /me/passkeys': jsonResponse({ data: [] }),
        'POST /invitations': problem(403, 'AUTHZ.REAUTH_REQUIRED'),
      });
      renderApp('/users');
      await submitInvitation(user);

      const dialog = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
      await waitFor(() => {
        expect(api.callsTo('GET', '/me/passkeys')).toHaveLength(1);
      });

      expect(
        within(dialog).queryByRole('button', { name: es.common['reauth.passkey'] }),
      ).not.toBeInTheDocument();
    });
  });
});
