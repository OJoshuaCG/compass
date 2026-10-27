import { resources } from '@iam/i18n';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

type Stage = 'anonymous' | 'password' | 'mfa' | 'enrollment' | 'full';

/** `/me` según la etapa que fijan las demás respuestas, como lo haría el servidor. */
function sessionApi(initial: Stage) {
  const state: { stage: Stage } = { stage: initial };
  const handlers = {
    'GET /me': () => {
      switch (state.stage) {
        case 'anonymous':
          return problem(401, 'AUTHZ.SESSION');
        case 'password':
          return problem(403, 'AUTH.PASSWORD_CHANGE_REQUIRED');
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

const CURRENT = 'initial-one-time-password';
const NEXT = 'a much better passphrase 2026';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const OTPAUTH = `otpauth://totp/IAM:ana@example.com?secret=${SECRET}&issuer=IAM`;

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, next = NEXT) {
  await user.type(
    await screen.findByLabelText(new RegExp(`^${es.auth['passwordChange.current']}`)),
    CURRENT,
  );
  await user.type(field(es.auth['passwordChange.new']), next);
  await user.click(screen.getByRole('button', { name: es.auth['passwordChange.submit'] }));
}

describe('login -> password change', () => {
  it('redirects to /password/change when login answers password_change_required', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('anonymous');
    stubApi({
      ...handlers,
      'POST /auth/login': () => {
        state.stage = 'password';
        return jsonResponse({ status: 'password_change_required' });
      },
    });
    const { router } = renderApp('/login');
    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['login.email']}`)),
      'root@example.com',
    );
    await user.type(field(es.auth['login.password']), CURRENT);
    await user.click(screen.getByRole('button', { name: es.auth['login.submit'] }));
    await screen.findByRole('heading', { level: 1, name: es.auth['passwordChange.title'] });
    expect(router.state.location.pathname).toBe('/password/change');
  });

  it('sends a private route with a pending change to /password/change keeping the return path', async () => {
    stubApi(sessionApi('password').handlers);
    const { router } = renderApp('/users?limit=50');
    await screen.findByRole('heading', { level: 1, name: es.auth['passwordChange.title'] });
    expect(router.state.location.pathname).toBe('/password/change');
    expect(router.state.location.search).toEqual({ returnTo: '/users?limit=50' });
  });

  it('keeps an anonymous user out of /password/change', async () => {
    stubApi(sessionApi('anonymous').handlers);
    renderApp('/password/change');
    await screen.findByRole('heading', { level: 1, name: es.auth['login.title'] });
  });

  it('does not bounce the user between screens whatever /me answers for the half session', async () => {
    // Si el servidor responde MFA_REQUIRED mientras el cambio sigue pendiente, esta pantalla debe
    // quedarse: si redirigiera, el enlace `MFA -> /password/change -> MFA` sería un bucle.
    stubApi(sessionApi('mfa').handlers);
    const { router } = renderApp('/password/change');
    await screen.findByRole('heading', { level: 1, name: es.auth['passwordChange.title'] });
    expect(router.state.location.pathname).toBe('/password/change');
  });
});

describe('password change form', () => {
  it('is accessible, focuses the first field and shows the strength meter without sending it anywhere', async () => {
    const user = userEvent.setup();
    const api = stubApi(sessionApi('password').handlers);
    const { container } = renderApp('/password/change');
    const current = await screen.findByLabelText(
      new RegExp(`^${es.auth['passwordChange.current']}`),
    );
    await waitFor(() => {
      expect(current).toHaveFocus();
    });
    expect(current).toHaveAttribute('autocomplete', 'current-password');
    expect(field(es.auth['passwordChange.new'])).toHaveAttribute('autocomplete', 'new-password');
    await user.type(field(es.auth['passwordChange.new']), NEXT);
    expect(screen.getByRole('meter', { name: es.auth['strength.label'] })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    // Ninguna petición salvo `/me`: el medidor corre en el navegador.
    expect(api.calls.filter((call) => call.path !== '/me')).toHaveLength(0);
  });

  it('validates on the client with translated messages and sends nothing', async () => {
    const user = userEvent.setup();
    const api = stubApi(sessionApi('password').handlers);
    renderApp('/password/change');
    await user.click(await screen.findByRole('button', { name: es.auth['passwordChange.submit'] }));
    expect(await screen.findAllByText(es.common['validation.required'])).toHaveLength(2);

    await user.type(field(es.auth['passwordChange.current']), CURRENT);
    await user.type(field(es.auth['passwordChange.new']), 'short');
    await user.click(screen.getByRole('button', { name: es.auth['passwordChange.submit'] }));
    expect(
      await screen.findByText(es.common['validation.passwordTooShort'].replace('{{min}}', '12')),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/auth/password/change')).toHaveLength(0);
  });

  it('changes the password, then follows /me: enrollment', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('password');
    const api = stubApi({
      ...handlers,
      'POST /auth/password/change': () => {
        state.stage = 'enrollment';
        return noContent();
      },
      'POST /auth/mfa/totp/enroll': jsonResponse({ secret: SECRET, otpauthUri: OTPAUTH }),
    });
    const { router, queryClient } = renderApp('/password/change');
    await fillAndSubmit(user);
    await screen.findByRole('heading', { level: 1, name: es.auth['enroll.title'] });
    expect(router.state.location.pathname).toBe('/enroll');

    const call = api.callsTo('POST', '/auth/password/change')[0];
    expect(call?.body).toEqual({ currentPassword: CURRENT, newPassword: NEXT });
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    // Ninguna contraseña en la caché de Query ni en el almacenamiento del navegador.
    expectNoSecretsStored(queryClient, [CURRENT, NEXT]);
  });

  it('follows /me to the MFA code when the second factor is already registered', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('password');
    stubApi({
      ...handlers,
      'POST /auth/password/change': () => {
        state.stage = 'mfa';
        return noContent();
      },
    });
    const { router } = renderApp('/password/change');
    await fillAndSubmit(user);
    await screen.findByRole('heading', { level: 1, name: es.auth['mfa.title'] });
    expect(router.state.location.pathname).toBe('/login/mfa');
  });

  it('goes to the app (and the original route) when /me answers 200', async () => {
    const user = userEvent.setup();
    const { state, handlers } = sessionApi('password');
    stubApi({
      ...handlers,
      'POST /auth/password/change': () => {
        state.stage = 'full';
        return noContent();
      },
      'GET /users': jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    });
    const { router, queryClient } = renderApp('/users');
    await fillAndSubmit(user);
    await screen.findByRole('heading', { level: 1, name: es.directory['users.title'] });
    expect(router.state.location.pathname).toBe('/users');
    expectNoSecretsStored(queryClient, [CURRENT, NEXT]);
  });

  it('shows a wrong current password in its own field and keeps the page', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      ...sessionApi('password').handlers,
      'POST /auth/password/change': problem(401, 'AUTH.INVALID_CREDENTIALS'),
    });
    const { router } = renderApp('/password/change');
    await fillAndSubmit(user);
    const current = field(es.auth['passwordChange.current']);
    await waitFor(() => {
      expect(current).toHaveAccessibleDescription(es.auth['passwordChange.currentIncorrect']);
    });
    await waitFor(() => {
      expect(current).toHaveFocus();
    });
    // Un 401 de credenciales no es "sesión expirada": no hay redirección.
    expect(router.state.location.pathname).toBe('/password/change');
    expect(api.callsTo('POST', '/auth/password/change')).toHaveLength(1);
  });

  it.each(['PASSWORD.WEAK', 'PASSWORD.REUSED'] as const)(
    'shows %s in the new password field',
    async (code) => {
      const user = userEvent.setup();
      stubApi({
        ...sessionApi('password').handlers,
        'POST /auth/password/change': problem(422, code),
      });
      renderApp('/password/change');
      await fillAndSubmit(user);
      const next = field(es.auth['passwordChange.new']);
      await waitFor(() => {
        expect(next).toHaveAccessibleDescription(new RegExp(es.errors[code]));
      });
      await waitFor(() => {
        expect(next).toHaveFocus();
      });
      expect(next).toHaveAttribute('aria-invalid', 'true');
    },
  );

  it('disables the button during a 429 and shows the wait time', async () => {
    const user = userEvent.setup();
    stubApi({
      ...sessionApi('password').handlers,
      'POST /auth/password/change': problem(429, 'RATE_LIMITED', {
        headers: { 'Retry-After': '7' },
      }),
    });
    renderApp('/password/change');
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors.RATE_LIMITED);
    expect(screen.getByRole('button', { name: es.auth['passwordChange.submit'] })).toBeDisabled();
  });

  it('offers a retry when /me fails after the change and does not repeat the change', async () => {
    const user = userEvent.setup();
    let stage: Stage = 'password';
    let meFails = false;
    const api = stubApi({
      'GET /me': () => {
        if (meFails) return problem(500, 'INTERNAL');
        return stage === 'password'
          ? problem(403, 'AUTH.PASSWORD_CHANGE_REQUIRED')
          : problem(403, 'AUTH.ENROLLMENT_REQUIRED');
      },
      'POST /auth/password/change': () => {
        stage = 'enrollment';
        meFails = true;
        return noContent();
      },
      'POST /auth/mfa/totp/enroll': jsonResponse({ secret: SECRET, otpauthUri: OTPAUTH }),
    });
    renderApp('/password/change');
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // El formulario ya no está: las contraseñas dejaron de estar en memoria.
    expect(screen.queryByLabelText(new RegExp(`^${es.auth['passwordChange.new']}`))).toBeNull();
    meFails = false;
    await user.click(screen.getByRole('button', { name: es.common['actions.retry'] }));
    await screen.findByRole('heading', { level: 1, name: es.auth['enroll.title'] });
    expect(api.callsTo('POST', '/auth/password/change')).toHaveLength(1);
  });

  it('renders in English without literal Spanish text', async () => {
    stubApi(sessionApi('password').handlers);
    renderApp('/password/change', 'en-US');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: resources['en-US'].auth['passwordChange.title'],
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(es.auth['passwordChange.title'])).toBeNull();
  });
});

describe('AUTH.PASSWORD_CHANGE_REQUIRED from the second-factor endpoints', () => {
  it('redirects from enrollment start', async () => {
    const { handlers } = sessionApi('enrollment');
    stubApi({
      ...handlers,
      'POST /auth/mfa/totp/enroll': problem(403, 'AUTH.PASSWORD_CHANGE_REQUIRED'),
    });
    const { router } = renderApp('/enroll');
    await screen.findByRole('heading', { level: 1, name: es.auth['passwordChange.title'] });
    expect(router.state.location.pathname).toBe('/password/change');
  });

  it('redirects from enrollment confirm', async () => {
    const user = userEvent.setup();
    stubApi({
      ...sessionApi('enrollment').handlers,
      'POST /auth/mfa/totp/enroll': jsonResponse({ secret: SECRET, otpauthUri: OTPAUTH }),
      'POST /auth/mfa/totp/confirm': problem(403, 'AUTH.PASSWORD_CHANGE_REQUIRED'),
    });
    const { router } = renderApp('/enroll');
    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['enroll.code']}`)),
      '123456',
    );
    await user.click(screen.getByRole('button', { name: es.auth['enroll.confirm'] }));
    await screen.findByRole('heading', { level: 1, name: es.auth['passwordChange.title'] });
    expect(router.state.location.pathname).toBe('/password/change');
  });

  it('redirects from MFA verify and from the recovery code, keeping the return path', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      ...sessionApi('mfa').handlers,
      'POST /auth/mfa/verify': problem(403, 'AUTH.PASSWORD_CHANGE_REQUIRED'),
      'POST /auth/mfa/recovery': problem(403, 'AUTH.PASSWORD_CHANGE_REQUIRED'),
    });
    const first = renderApp('/login/mfa?returnTo=%2Fusers');
    await user.type(await screen.findByLabelText(new RegExp(`^${es.auth['mfa.code']}`)), '123456');
    await user.click(screen.getByRole('button', { name: es.auth['mfa.submit'] }));
    await screen.findByRole('heading', { level: 1, name: es.auth['passwordChange.title'] });
    expect(first.router.state.location.pathname).toBe('/password/change');
    expect(first.router.state.location.search).toEqual({ returnTo: '/users' });
    expect(api.callsTo('POST', '/auth/mfa/verify')).toHaveLength(1);
    first.unmount();

    const second = renderApp('/login/mfa');
    await user.click(await screen.findByRole('button', { name: es.auth['mfa.useRecovery'] }));
    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['recovery.code']}`)),
      'ABCD-EFGH-12',
    );
    await user.click(screen.getByRole('button', { name: es.auth['recovery.submit'] }));
    await screen.findByRole('heading', { level: 1, name: es.auth['passwordChange.title'] });
    expect(second.router.state.location.pathname).toBe('/password/change');
    expect(api.callsTo('POST', '/auth/mfa/recovery')).toHaveLength(1);
  });
});
