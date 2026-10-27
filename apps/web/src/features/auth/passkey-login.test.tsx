import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const lib = vi.hoisted(() => ({
  loaded: false,
  startAuthentication: vi.fn(),
}));

// La fábrica corre al importar la biblioteca por primera vez: `loaded` prueba que el `import()`
// dinámico solo ocurre al empezar la ceremonia.
vi.mock('@simplewebauthn/browser', () => {
  lib.loaded = true;
  return { startAuthentication: lib.startAuthentication };
});

const OPTIONS = { challenge: 'challenge-abc', rpId: 'localhost', allowCredentials: [] };
const ASSERTION = { id: 'cred-1', type: 'public-key', response: { signature: 'SIGNATURE-SECRET' } };

type Stage = 'anonymous' | 'mfa' | 'full';

function sessionApi(initial: Stage) {
  const state = { stage: initial };
  const handlers = {
    'GET /me': () => {
      switch (state.stage) {
        case 'anonymous':
          return problem(401, 'AUTHZ.SESSION');
        case 'mfa':
          return problem(403, 'AUTH.MFA_REQUIRED');
        case 'full':
          return jsonResponse(meFixture());
      }
    },
  };
  return { state, handlers };
}

const passkeyButton = () => screen.queryByRole('button', { name: es.auth['mfa.usePasskey'] });

beforeEach(() => {
  lib.startAuthentication.mockReset();
});

describe('MFA with a passkey', () => {
  it('does not download the WebAuthn library until the ceremony starts', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('mfa');
    stubApi({
      ...handlers,
      'POST /auth/passkey/options': jsonResponse(OPTIONS),
      'POST /auth/passkey/verify': () => {
        state.stage = 'full';
        return noContent();
      },
    });
    lib.startAuthentication.mockResolvedValue(ASSERTION);
    renderApp('/login/mfa');
    await screen.findByRole('heading', { level: 1, name: es.auth['mfa.title'] });
    expect(lib.loaded).toBe(false);
    await user.click(screen.getByRole('button', { name: es.auth['mfa.usePasskey'] }));
    await waitFor(() => {
      expect(lib.loaded).toBe(true);
    });
  });

  it('offers the button after a login that reports passkeys, with the TOTP form and recovery still there', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('anonymous');
    stubApi({
      ...handlers,
      'POST /auth/login': () => {
        state.stage = 'mfa';
        return jsonResponse({ status: 'mfa_required', passkeys: true });
      },
    });
    const { container } = renderApp('/login');
    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['login.email']}`)),
      'a@b.co',
    );
    await user.type(
      screen.getByLabelText(new RegExp(`^${es.auth['login.password']}`)),
      'correct horse battery',
    );
    await user.click(screen.getByRole('button', { name: es.auth['login.submit'] }));

    await screen.findByRole('heading', { level: 1, name: es.auth['mfa.title'] });
    expect(passkeyButton()).toBeVisible();
    expect(screen.getByLabelText(new RegExp(`^${es.auth['mfa.code']}`))).toBeVisible();
    expect(screen.getByRole('button', { name: es.auth['mfa.useRecovery'] })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('hides the button when the login says there are no passkeys, and keeps it when unknown', async () => {
    const { handlers } = sessionApi('mfa');
    stubApi(handlers);
    const none = renderApp('/login/mfa?passkeys=false');
    await screen.findByRole('heading', { level: 1, name: es.auth['mfa.title'] });
    expect(passkeyButton()).toBeNull();
    none.unmount();

    // Sin dato (recarga, o llegada tras cambiar la contraseña): se ofrece; el servidor decide.
    renderApp('/login/mfa');
    await screen.findByRole('heading', { level: 1, name: es.auth['mfa.title'] });
    expect(passkeyButton()).toBeVisible();
  });

  it('signs in: options, browser prompt, verify, then continues like the TOTP success path', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('mfa');
    const api = stubApi({
      ...handlers,
      'POST /auth/passkey/options': jsonResponse(OPTIONS),
      'POST /auth/passkey/verify': () => {
        state.stage = 'full';
        return noContent();
      },
    });
    lib.startAuthentication.mockResolvedValue(ASSERTION);
    const { queryClient } = renderApp('/login/mfa?passkeys=true');
    await user.click(await screen.findByRole('button', { name: es.auth['mfa.usePasskey'] }));

    expect(
      await screen.findByRole('heading', { level: 1, name: es.common['home.title'] }),
    ).toBeInTheDocument();
    expect(lib.startAuthentication).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    const verify = api.callsTo('POST', '/auth/passkey/verify')[0];
    expect(verify?.body).toEqual({ response: ASSERTION });
    expect(verify?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expectNoSecretsStored(queryClient, ['SIGNATURE-SECRET', 'challenge-abc']);
  });

  it('shows a neutral hint, not a server error, when the person cancels the browser prompt', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('mfa');
    const api = stubApi({ ...handlers, 'POST /auth/passkey/options': jsonResponse(OPTIONS) });
    lib.startAuthentication.mockRejectedValue(
      Object.assign(new Error('The operation either timed out or was not allowed.'), {
        name: 'NotAllowedError',
      }),
    );
    const { router } = renderApp('/login/mfa?passkeys=true');
    await user.click(await screen.findByRole('button', { name: es.auth['mfa.usePasskey'] }));

    expect(await screen.findByText(es.auth['mfa.passkeyCancelled'])).toBeInTheDocument();
    expect(screen.queryByText(es.errors['AUTH.MFA_INVALID'])).toBeNull();
    expect(screen.queryByText(es.errors.generic)).toBeNull();
    expect(api.callsTo('POST', '/auth/passkey/verify')).toHaveLength(0);
    expect(router.state.location.pathname).toBe('/login/mfa');
    expect(passkeyButton()).toBeEnabled();
  });

  it('shows the translated server error and stays on the screen when verification fails', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('mfa');
    stubApi({
      ...handlers,
      'POST /auth/passkey/options': jsonResponse(OPTIONS),
      'POST /auth/passkey/verify': problem(401, 'AUTH.MFA_INVALID'),
    });
    lib.startAuthentication.mockResolvedValue(ASSERTION);
    const { router, container } = renderApp('/login/mfa?passkeys=true');
    await user.click(await screen.findByRole('button', { name: es.auth['mfa.usePasskey'] }));

    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['AUTH.MFA_INVALID']);
    expect(router.state.location.pathname).toBe('/login/mfa');
    expect(screen.queryByText(es.auth['mfa.passkeyCancelled'])).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the rate limit message from the server', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('mfa');
    stubApi({
      ...handlers,
      'POST /auth/passkey/options': problem(429, 'RATE_LIMITED', {
        headers: { 'Retry-After': '30' },
      }),
    });
    renderApp('/login/mfa?passkeys=true');
    await user.click(await screen.findByRole('button', { name: es.auth['mfa.usePasskey'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors.RATE_LIMITED);
  });

  it('shows a client-side message when the browser or authenticator fails', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('mfa');
    stubApi({ ...handlers, 'POST /auth/passkey/options': jsonResponse(OPTIONS) });
    lib.startAuthentication.mockRejectedValue(
      Object.assign(new Error('no authenticator'), { name: 'NotSupportedError' }),
    );
    renderApp('/login/mfa?passkeys=true');
    await user.click(await screen.findByRole('button', { name: es.auth['mfa.usePasskey'] }));
    expect(await screen.findByText(es.errors.generic)).toBeInTheDocument();
  });
});
