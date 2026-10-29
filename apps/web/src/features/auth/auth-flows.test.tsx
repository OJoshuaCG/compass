import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

type Stage = 'anonymous' | 'mfa' | 'enrollment' | 'full';

/** `/me` que cambia según la etapa que fijan las demás respuestas (como lo haría el servidor). */
function sessionApi(initial: Stage) {
  const state = { stage: initial };
  const handlers = {
    'GET /me': () => {
      switch (state.stage) {
        case 'anonymous':
          return problem(401, 'AUTHZ.SESSION');
        case 'mfa':
          return problem(403, 'AUTH.MFA_REQUIRED');
        case 'enrollment':
          return problem(403, 'AUTH.ENROLLMENT_REQUIRED');
        case 'full':
          return jsonResponse(meFixture());
      }
    },
  };
  return { state, handlers };
}

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const OTPAUTH = `otpauth://totp/IAM:ana@example.com?secret=${SECRET}&issuer=IAM`;
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `RC${String(i)}A-B7K9Q2ZX`);
const TOKEN = 'tok_0123456789abcdefghij_ABCDEFG';

describe('login -> MFA', () => {
  it('signs in, asks for the TOTP code and lands on the app', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('anonymous');
    const api = stubApi({
      ...handlers,
      'POST /auth/login': () => {
        state.stage = 'mfa';
        return jsonResponse({ status: 'mfa_required' });
      },
      'POST /auth/mfa/verify': () => {
        state.stage = 'full';
        return noContent();
      },
    });
    const { queryClient, container } = renderApp('/login');

    await screen.findByRole('heading', { level: 1, name: es.auth['login.title'] });
    expect(await axeViolations(container)).toEqual([]);
    await user.type(field(es.auth['login.email']), 'Ana@Example.com');
    await user.type(field(es.auth['login.password']), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: es.auth['login.submit'] }));

    await screen.findByRole('heading', { level: 1, name: es.auth['mfa.title'] });
    const login = api.callsTo('POST', '/auth/login')[0];
    expect(login?.body).toEqual({ email: 'ana@example.com', password: 'correct horse battery' });
    expect(login?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(login?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);

    await user.type(field(es.auth['mfa.code']), '123 456');
    await user.click(screen.getByRole('button', { name: es.auth['mfa.submit'] }));

    expect(
      await screen.findByRole('heading', { level: 1, name: es.common['home.title'] }),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/auth/mfa/verify')[0]?.body).toEqual({ code: '123456' });
    expectNoSecretsStored(queryClient, ['correct horse battery', '123456']);
  });

  it('shows the translated error for wrong credentials without leaving the page', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('anonymous');
    stubApi({ ...handlers, 'POST /auth/login': problem(401, 'AUTH.INVALID_CREDENTIALS') });
    const { router } = renderApp('/login');

    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['login.email']}`)),
      'a@b.co',
    );
    await user.type(field(es.auth['login.password']), 'whatever');
    await user.click(screen.getByRole('button', { name: es.auth['login.submit'] }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      es.errors['AUTH.INVALID_CREDENTIALS'],
    );
    // Un 401 de credenciales no es "sesión expirada": no hay redirección ni se vacía nada.
    expect(router.state.location.pathname).toBe('/login');
  });

  it('validates the form with translated messages and sends nothing', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('anonymous');
    const api = stubApi(handlers);
    renderApp('/login');
    await user.click(await screen.findByRole('button', { name: es.auth['login.submit'] }));
    expect(await screen.findAllByText(es.common['validation.required'])).toHaveLength(2);
    expect(api.callsTo('POST', '/auth/login')).toHaveLength(0);
  });

  it('disables the submit button during a 429 and shows the wait time', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('anonymous');
    stubApi({
      ...handlers,
      'POST /auth/login': problem(429, 'RATE_LIMITED', { headers: { 'Retry-After': '7' } }),
    });
    renderApp('/login');
    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['login.email']}`)),
      'a@b.co',
    );
    await user.type(field(es.auth['login.password']), 'whatever');
    await user.click(screen.getByRole('button', { name: es.auth['login.submit'] }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors['RATE_LIMITED']);
    expect(alert).not.toHaveTextContent('Reintenta en 7 s.');
    expect(screen.getByRole('timer')).toHaveTextContent('Reintenta en 7 s.');
    expect(screen.getByRole('button', { name: es.auth['login.submit'] })).toBeDisabled();
  });

  it('shows a generic error with the request id on a 5xx', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('anonymous');
    stubApi({ ...handlers, 'POST /auth/login': problem(500, 'INTERNAL') });
    renderApp('/login');
    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['login.email']}`)),
      'a@b.co',
    );
    await user.type(field(es.auth['login.password']), 'whatever');
    await user.click(screen.getByRole('button', { name: es.auth['login.submit'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent('req-test-1');
  });

  it('sends the user to enrollment when the second factor is not registered yet', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('anonymous');
    stubApi({
      ...handlers,
      'POST /auth/login': () => {
        state.stage = 'enrollment';
        return jsonResponse({ status: 'enrollment_required' });
      },
      'POST /auth/mfa/totp/enroll': jsonResponse({ secret: SECRET, otpauthUri: OTPAUTH }),
    });
    const { router } = renderApp('/login');
    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['login.email']}`)),
      'a@b.co',
    );
    await user.type(field(es.auth['login.password']), 'whatever');
    await user.click(screen.getByRole('button', { name: es.auth['login.submit'] }));
    await screen.findByRole('heading', { level: 1, name: es.auth['enroll.title'] });
    expect(router.state.location.pathname).toBe('/enroll');
  });
});

describe('MFA recovery code', () => {
  it('switches to a recovery code and verifies it', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('mfa');
    const api = stubApi({
      ...handlers,
      'POST /auth/mfa/recovery': () => {
        state.stage = 'full';
        return noContent();
      },
    });
    renderApp('/login/mfa');
    await screen.findByRole('heading', { level: 1, name: es.auth['mfa.title'] });
    await user.click(screen.getByRole('button', { name: es.auth['mfa.useRecovery'] }));
    await screen.findByRole('heading', { level: 1, name: es.auth['recovery.title'] });
    await user.type(field(es.auth['recovery.code']), 'RC0A-B7K9Q2ZX');
    await user.click(screen.getByRole('button', { name: es.auth['recovery.submit'] }));
    await screen.findByRole('heading', { level: 1, name: es.common['home.title'] });
    expect(api.callsTo('POST', '/auth/mfa/recovery')[0]?.body).toEqual({ code: 'RC0A-B7K9Q2ZX' });
  });

  it('shows a wrong TOTP code as an error', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('mfa');
    stubApi({ ...handlers, 'POST /auth/mfa/verify': problem(401, 'AUTH.MFA_INVALID') });
    const { router } = renderApp('/login/mfa');
    await user.type(await screen.findByLabelText(new RegExp(`^${es.auth['mfa.code']}`)), '000000');
    await user.click(screen.getByRole('button', { name: es.auth['mfa.submit'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['AUTH.MFA_INVALID']);
    expect(router.state.location.pathname).toBe('/login/mfa');
  });
});

describe('TOTP enrollment', () => {
  it('shows the QR and key, confirms, shows recovery codes once and discards them', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('enrollment');
    const api = stubApi({
      ...handlers,
      'POST /auth/mfa/totp/enroll': jsonResponse({ secret: SECRET, otpauthUri: OTPAUTH }),
      'POST /auth/mfa/totp/confirm': () => {
        state.stage = 'full';
        return jsonResponse({ recoveryCodes: RECOVERY_CODES });
      },
    });
    const { queryClient, router, container } = renderApp('/enroll');

    const qr = await screen.findByRole('img', { name: es.auth['enroll.qrAlt'] });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(qr).toHaveAttribute('width');
    expect(qr).toHaveAttribute('height');
    // La URI con la clave nunca se envía fuera: solo hubo una llamada a `enroll`.
    expect(api.callsTo('POST', '/auth/mfa/totp/enroll')).toHaveLength(1);
    expect(screen.getByLabelText(es.auth['enroll.secretLabel'])).toHaveTextContent(SECRET);
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('button', { name: es.auth['enroll.copySecret'] }));
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    // El texto aparece dos veces a propósito: la región `status` (lectores) y el texto visible.
    expect(
      screen.getByText(es.common['clipboard.copied'], { selector: '[role="status"]' }),
    ).toBeInTheDocument();

    await user.type(field(es.auth['enroll.code']), '654321');
    await user.click(screen.getByRole('button', { name: es.auth['enroll.confirm'] }));

    await screen.findByRole('heading', { level: 1, name: es.auth['enroll.recovery.title'] });
    const list = screen.getByRole('list', { name: es.auth['enroll.recovery.list'] });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    // La clave se descartó en cuanto se confirmó.
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    // No se puede continuar sin confirmar que se guardaron.
    const proceed = screen.getByRole('button', { name: es.auth['enroll.recovery.continue'] });
    expect(proceed).toBeDisabled();
    expectNoSecretsStored(queryClient, [SECRET, OTPAUTH, ...RECOVERY_CODES, '654321']);

    await user.click(screen.getByRole('checkbox', { name: es.auth['enroll.recovery.saved'] }));
    await user.click(proceed);

    await screen.findByRole('heading', { level: 1, name: es.common['home.title'] });
    expect(router.state.location.pathname).toBe('/');
    for (const code of RECOVERY_CODES) expect(screen.queryByText(code)).not.toBeInTheDocument();
    expectNoSecretsStored(queryClient, [SECRET, OTPAUTH, ...RECOVERY_CODES, '654321']);
  });

  it('shows the error and a retry button when the setup cannot start', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('enrollment');
    let attempts = 0;
    stubApi({
      ...handlers,
      'POST /auth/mfa/totp/enroll': () => {
        attempts += 1;
        return attempts === 1
          ? problem(500, 'INTERNAL')
          : jsonResponse({ secret: SECRET, otpauthUri: OTPAUTH });
      },
    });
    renderApp('/enroll');
    expect(await screen.findByRole('alert')).toHaveTextContent('req-test-1');
    await user.click(screen.getByRole('button', { name: es.common['actions.retry'] }));
    expect(await screen.findByRole('img', { name: es.auth['enroll.qrAlt'] })).toBeInTheDocument();
  });
});

describe('accept invitation', () => {
  const preview = { email: 'luis@example.com', rank: 2, expiresAt: '2030-01-04T12:00:00.000Z' };

  it('previews the invitation, shows WEAK passwords in the field and then enrolls', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('anonymous');
    let accepts = 0;
    const api = stubApi({
      ...handlers,
      'POST /invitations/preview': jsonResponse(preview),
      'POST /invitations/accept': () => {
        accepts += 1;
        if (accepts === 1) return problem(422, 'PASSWORD.WEAK');
        state.stage = 'enrollment';
        return jsonResponse({ status: 'enrollment_required' });
      },
      'POST /auth/mfa/totp/enroll': jsonResponse({ secret: SECRET, otpauthUri: OTPAUTH }),
    });
    const { router, container } = renderApp(`/invitation?token=${TOKEN}`);

    expect(await screen.findByText('luis@example.com')).toBeInTheDocument();
    expect(screen.getByText(es.common['rank.2'])).toBeInTheDocument();
    expect(api.callsTo('POST', '/invitations/preview')[0]?.body).toEqual({ token: TOKEN });
    // El token es de un solo uso: se retira de la URL en cuanto se lee.
    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty('token');
    });
    expect(await axeViolations(container)).toEqual([]);

    await user.type(field(es.auth['invitation.displayName']), 'Luis Gómez');
    const password = field(es.auth['invitation.password']);
    await user.type(password, 'password1234');
    expect(screen.getByRole('meter', { name: es.auth['strength.label'] })).toBeInTheDocument();
    // Mientras se escribe, la contraseña no sale a ningún lado.
    expect(api.callsTo('POST', '/invitations/accept')).toHaveLength(0);
    expect(api.calls.every((call) => call.path.startsWith('/'))).toBe(true);

    await user.click(screen.getByRole('button', { name: es.auth['invitation.submit'] }));
    await waitFor(() => {
      expect(password).toHaveAccessibleDescription(
        expect.stringContaining(es.errors['PASSWORD.WEAK']),
      );
    });
    expect(password).toBeInvalid();
    expect(router.state.location.pathname).toBe('/invitation');

    await user.clear(password);
    await user.type(password, 'caballo bateria grapa correcto');
    await user.click(screen.getByRole('button', { name: es.auth['invitation.submit'] }));
    await screen.findByRole('heading', { level: 1, name: es.auth['enroll.title'] });
    expect(api.callsTo('POST', '/invitations/accept')[1]?.body).toEqual({
      token: TOKEN,
      displayName: 'Luis Gómez',
      password: 'caballo bateria grapa correcto',
    });
  });

  it('reads the token from the URL fragment and removes it from the URL', async () => {
    const { handlers } = sessionApi('anonymous');
    const api = stubApi({ ...handlers, 'POST /invitations/preview': jsonResponse(preview) });
    const { router } = renderApp(`/invitation#token=${TOKEN}`);
    expect(await screen.findByText('luis@example.com')).toBeInTheDocument();
    expect(api.callsTo('POST', '/invitations/preview')[0]?.body).toEqual({ token: TOKEN });
    await waitFor(() => {
      expect(router.state.location.hash).toBe('');
    });
  });

  it('enforces the 12-character minimum on the client without sending anything', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('anonymous');
    const api = stubApi({ ...handlers, 'POST /invitations/preview': jsonResponse(preview) });
    renderApp(`/invitation?token=${TOKEN}`);
    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['invitation.displayName']}`)),
      'Luis',
    );
    await user.type(field(es.auth['invitation.password']), 'short');
    await user.click(screen.getByRole('button', { name: es.auth['invitation.submit'] }));
    expect(await screen.findByText('Usa al menos 12 caracteres.')).toBeInTheDocument();
    expect(api.callsTo('POST', '/invitations/accept')).toHaveLength(0);
  });

  it('toggles password visibility with an accessible button', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('anonymous');
    stubApi({ ...handlers, 'POST /invitations/preview': jsonResponse(preview) });
    renderApp(`/invitation?token=${TOKEN}`);
    const password = await screen.findByLabelText(new RegExp(`^${es.auth['invitation.password']}`));
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: es.common['password.show'] }));
    expect(password).toHaveAttribute('type', 'text');
  });

  it('shows the invalid-invitation state on a 404 and when the token is missing', async () => {
    const { handlers } = sessionApi('anonymous');
    stubApi({ ...handlers, 'POST /invitations/preview': problem(404, 'INVITATION.INVALID') });
    const first = renderApp(`/invitation?token=${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['INVITATION.INVALID']);
    first.unmount();

    renderApp('/invitation');
    expect(await screen.findByRole('alert')).toHaveTextContent(es.auth['invitation.missingToken']);
  });
});

describe('route guards', () => {
  it('redirects a private route to /login keeping the return path', async () => {
    const { handlers } = sessionApi('anonymous');
    stubApi(handlers);
    const { router } = renderApp('/users?limit=50');
    await screen.findByRole('heading', { level: 1, name: es.auth['login.title'] });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ returnTo: '/users?limit=50' });
  });

  it('sends a half-open session to the MFA code or to enrollment', async () => {
    const mfa = sessionApi('mfa');
    stubApi(mfa.handlers);
    const first = renderApp('/users');
    await screen.findByRole('heading', { level: 1, name: es.auth['mfa.title'] });
    expect(first.router.state.location.pathname).toBe('/login/mfa');
    first.unmount();

    const enrollment = sessionApi('enrollment');
    stubApi({
      ...enrollment.handlers,
      'POST /auth/mfa/totp/enroll': jsonResponse({ secret: SECRET, otpauthUri: OTPAUTH }),
    });
    const second = renderApp('/users');
    await screen.findByRole('heading', { level: 1, name: es.auth['enroll.title'] });
    expect(second.router.state.location.pathname).toBe('/enroll');
  });

  it('keeps an anonymous user out of /login/mfa and /enroll', async () => {
    const { handlers } = sessionApi('anonymous');
    stubApi(handlers);
    const first = renderApp('/login/mfa');
    await screen.findByRole('heading', { level: 1, name: es.auth['login.title'] });
    first.unmount();
    renderApp('/enroll');
    await screen.findByRole('heading', { level: 1, name: es.auth['login.title'] });
  });

  it('redirects a signed-in user away from /login', async () => {
    const { handlers } = sessionApi('full');
    stubApi(handlers);
    const { router } = renderApp('/login');
    await screen.findByRole('heading', { level: 1, name: es.common['home.title'] });
    expect(router.state.location.pathname).toBe('/');
  });

  it('ignores a return path that points outside the app', async () => {
    const { handlers } = sessionApi('anonymous');
    stubApi(handlers);
    const { router } = renderApp('/login?returnTo=//evil.example/steal');
    await screen.findByRole('heading', { level: 1, name: es.auth['login.title'] });
    expect(router.state.location.search).toEqual({ returnTo: undefined });
  });

  it('goes back to the original route after completing the second factor', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('mfa');
    stubApi({
      ...handlers,
      'POST /auth/mfa/verify': () => {
        state.stage = 'full';
        return noContent();
      },
      'GET /users': jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    });
    const { router } = renderApp('/users');
    await user.type(await screen.findByLabelText(new RegExp(`^${es.auth['mfa.code']}`)), '123456');
    await user.click(screen.getByRole('button', { name: es.auth['mfa.submit'] }));
    await screen.findByRole('heading', { level: 1, name: es.directory['users.title'] });
    expect(router.state.location.pathname).toBe('/users');
  });
});

describe('session expiry and logout', () => {
  it('clears the cache and goes to /login when a request returns 401 mid-session', async () => {
    const { state, handlers } = sessionApi('full');
    stubApi({
      ...handlers,
      'GET /users': () => {
        // El servidor revocó la sesión: `/me` también deja de responder 200.
        state.stage = 'anonymous';
        return problem(401, 'AUTHZ.SESSION');
      },
    });
    const { router, queryClient } = renderApp('/users');
    await screen.findByRole('heading', { level: 1, name: es.auth['login.title'] });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ returnTo: '/users?limit=25' });
    expect(queryClient.getQueryCache().find({ queryKey: ['directory'] })).toBeUndefined();
  });

  it('signs out on the server, empties the cache and goes to /login', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('full');
    const api = stubApi({
      ...handlers,
      'POST /auth/logout': () => {
        state.stage = 'anonymous';
        return noContent();
      },
    });
    const { router, queryClient } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: es.common['home.title'] });
    await user.click(screen.getByRole('button', { name: es.common['actions.logout'] }));
    await screen.findByRole('heading', { level: 1, name: es.auth['login.title'] });
    expect(api.callsTo('POST', '/auth/logout')).toHaveLength(1);
    expect(router.state.location.pathname).toBe('/login');
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .every((query) => query.queryKey[0] === 'session'),
    ).toBe(true);
  });

  it('keeps the session and warns when the server does not confirm the logout', async () => {
    const user = userEvent.setup();
    const { handlers } = sessionApi('full');
    stubApi({ ...handlers, 'POST /auth/logout': problem(500, 'INTERNAL') });
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: es.common['home.title'] });
    await user.click(screen.getByRole('button', { name: es.common['actions.logout'] }));
    expect(await screen.findByText(es.common['actions.logoutFailed'])).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('English locale', () => {
  it('renders the login screen without literal Spanish text', async () => {
    const { handlers } = sessionApi('anonymous');
    stubApi(handlers);
    renderApp('/login', 'en-US');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(vi.isMockFunction(fetch)).toBe(true);
  });
});
