import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const RETURN_TO = '/oidc/interaction/aB3_-xYz09';
const assign = vi.fn();

// El proveedor OIDC no es parte de la SPA: volver a él exige navegar la página completa.
beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal('location', {
    origin: window.location.origin,
    href: window.location.href,
    assign,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login with a return path to the OIDC provider', () => {
  it('navigates the full page to the provider after a TOTP login, not the SPA router', async () => {
    const user = userEvent.setup();
    const state = { stage: 'anonymous' as 'anonymous' | 'mfa' | 'full' };
    stubApi({
      'GET /me': () => {
        if (state.stage === 'anonymous') return problem(401, 'AUTHZ.SESSION');
        if (state.stage === 'mfa') return problem(403, 'AUTH.MFA_REQUIRED');
        return jsonResponse(meFixture());
      },
      'POST /auth/login': () => {
        state.stage = 'mfa';
        return jsonResponse({ status: 'mfa_required', passkeys: false });
      },
      'POST /auth/mfa/verify': () => {
        state.stage = 'full';
        return noContent();
      },
    });
    const { router } = renderApp(`/login?returnTo=${encodeURIComponent(RETURN_TO)}`);
    await user.type(
      await screen.findByLabelText(new RegExp(`^${es.auth['login.email']}`)),
      'a@b.co',
    );
    await user.type(
      screen.getByLabelText(new RegExp(`^${es.auth['login.password']}`)),
      'correct horse battery',
    );
    await user.click(screen.getByRole('button', { name: es.auth['login.submit'] }));
    await user.type(await screen.findByLabelText(new RegExp(`^${es.auth['mfa.code']}`)), '123456');
    await user.click(screen.getByRole('button', { name: es.auth['mfa.submit'] }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(RETURN_TO);
    });
    expect(router.state.location.pathname).not.toBe(RETURN_TO);
  });

  it('sends a person who is already signed in back to the provider instead of the home page', async () => {
    stubApi({ 'GET /me': jsonResponse(meFixture()) });
    const { router } = renderApp(`/login?returnTo=${encodeURIComponent(RETURN_TO)}`);
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(RETURN_TO);
    });
    // No se redirige dentro de la SPA al inicio.
    expect(router.state.location.pathname).not.toBe('/');
  });

  it('still sends a signed in person to the home page when there is no provider return path', async () => {
    stubApi({ 'GET /me': jsonResponse(meFixture()) });
    const { router } = renderApp('/login?returnTo=%2Fusers');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(assign).not.toHaveBeenCalled();
  });
});
