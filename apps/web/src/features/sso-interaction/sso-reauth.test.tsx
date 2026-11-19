import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadSsoCatalog } from '@iam/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es as shared, expectNoSecretsStored, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';
import type * as FullPageNavigation from './api/full-page-navigation';

const catalog = await loadSsoCatalog();
const esSso = catalog['es-MX'];

const navigation = vi.hoisted(() => ({ toProvider: vi.fn() }));
vi.mock('./api/full-page-navigation', async () => ({
  ...(await vi.importActual<typeof FullPageNavigation>('./api/full-page-navigation')),
  navigateToProvider: navigation.toProvider,
}));

const lib = vi.hoisted(() => ({ loaded: false, startAuthentication: vi.fn() }));
// La fábrica corre al importar la biblioteca: `loaded` prueba que la descarga es diferida.
vi.mock('@simplewebauthn/browser', () => {
  lib.loaded = true;
  return { startAuthentication: lib.startAuthentication };
});

const UID = 'aB3_-xYz09';
const PATH = `/sso/reauth?uid=${UID}`;
const OPTIONS = { challenge: 'challenge-abc', rpId: 'localhost', allowCredentials: [] };
const ASSERTION = { id: 'cred-1', type: 'public-key', response: { signature: 'SIGNATURE-SECRET' } };

const submitButton = () => screen.getByRole('button', { name: esSso['reauth.submit'] });
const passkeyButton = () => screen.getByRole('button', { name: esSso['reauth.usePasskey'] });

beforeEach(() => {
  navigation.toProvider.mockReset();
  lib.startAuthentication.mockReset();
});

describe('/sso/reauth with a TOTP code', () => {
  it('confirms the code and hands control back to the provider with a full page navigation', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      'GET /me': jsonResponse(meFixture()),
      'POST /auth/sso-reauth': noContent(),
    });
    const { queryClient, container } = renderApp(PATH);
    await screen.findByRole('heading', { level: 1, name: esSso['reauth.title'] });
    expect(await axeViolations(container)).toEqual([]);

    await user.type(field(esSso['reauth.code']), '123456');
    await user.click(submitButton());

    await waitFor(() => {
      expect(navigation.toProvider).toHaveBeenCalledWith(`/oidc/interaction/${UID}`);
    });
    expect(api.callsTo('POST', '/auth/sso-reauth')[0]?.body).toEqual({ code: '123456' });
    expect(submitButton()).toBeDisabled();
    expectNoSecretsStored(queryClient, ['123456']);
  });

  it('shows the translated error and stays on the screen when the code is invalid', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      'POST /auth/sso-reauth': problem(401, 'AUTH.MFA_INVALID'),
    });
    const { container } = renderApp(PATH);
    await user.type(await screen.findByLabelText(new RegExp(`^${esSso['reauth.code']}`)), '000000');
    await user.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(shared.errors['AUTH.MFA_INVALID']);
    expect(navigation.toProvider).not.toHaveBeenCalled();
    expect(submitButton()).toBeEnabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the rate limit message from the server', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      'POST /auth/sso-reauth': problem(429, 'RATE_LIMITED', { headers: { 'Retry-After': '30' } }),
    });
    renderApp(PATH);
    await user.type(await screen.findByLabelText(new RegExp(`^${esSso['reauth.code']}`)), '123456');
    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(shared.errors.RATE_LIMITED);
    expect(navigation.toProvider).not.toHaveBeenCalled();
  });

  it('validates the code locally before calling the server', async () => {
    const user = userEvent.setup();
    const api = stubApi({ 'GET /me': jsonResponse(meFixture()) });
    renderApp(PATH);
    await user.type(await screen.findByLabelText(new RegExp(`^${esSso['reauth.code']}`)), '12');
    await user.click(submitButton());
    expect(await screen.findByText(shared.common['validation.code'])).toBeInTheDocument();
    expect(api.callsTo('POST', '/auth/sso-reauth')).toHaveLength(0);
  });
});

describe('/sso/reauth with a passkey', () => {
  it('requests options, asks the browser, verifies and resumes the provider flow', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      'GET /me': jsonResponse(meFixture()),
      'POST /auth/reauth/passkey/options': jsonResponse(OPTIONS),
      'POST /auth/sso-reauth/passkey/verify': noContent(),
    });
    lib.startAuthentication.mockResolvedValue(ASSERTION);
    const { queryClient } = renderApp(PATH);
    await screen.findByRole('heading', { level: 1, name: esSso['reauth.title'] });
    expect(lib.loaded).toBe(false);

    await user.click(passkeyButton());

    await waitFor(() => {
      expect(navigation.toProvider).toHaveBeenCalledWith(`/oidc/interaction/${UID}`);
    });
    expect(lib.startAuthentication).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    expect(api.callsTo('POST', '/auth/reauth/passkey/options')[0]?.body).toBeUndefined();
    expect(api.callsTo('POST', '/auth/sso-reauth/passkey/verify')[0]?.body).toEqual({
      response: ASSERTION,
    });
    expectNoSecretsStored(queryClient, ['SIGNATURE-SECRET', 'challenge-abc']);
  });

  it('shows a neutral hint when the person cancels the browser prompt', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      'GET /me': jsonResponse(meFixture()),
      'POST /auth/reauth/passkey/options': jsonResponse(OPTIONS),
    });
    lib.startAuthentication.mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }),
    );
    renderApp(PATH);
    await user.click(await screen.findByRole('button', { name: esSso['reauth.usePasskey'] }));

    expect(await screen.findByText(esSso['reauth.passkeyCancelled'])).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.callsTo('POST', '/auth/sso-reauth/passkey/verify')).toHaveLength(0);
    expect(navigation.toProvider).not.toHaveBeenCalled();
    expect(passkeyButton()).toBeEnabled();
  });

  it('shows the translated server error when verification fails', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      'POST /auth/reauth/passkey/options': jsonResponse(OPTIONS),
      'POST /auth/sso-reauth/passkey/verify': problem(401, 'AUTH.MFA_INVALID'),
    });
    lib.startAuthentication.mockResolvedValue(ASSERTION);
    renderApp(PATH);
    await user.click(await screen.findByRole('button', { name: esSso['reauth.usePasskey'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(shared.errors['AUTH.MFA_INVALID']);
    expect(navigation.toProvider).not.toHaveBeenCalled();
  });

  it('shows the generic message when the browser or authenticator fails', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      'POST /auth/reauth/passkey/options': jsonResponse(OPTIONS),
    });
    lib.startAuthentication.mockRejectedValue(
      Object.assign(new Error('no authenticator'), { name: 'NotSupportedError' }),
    );
    renderApp(PATH);
    await user.click(await screen.findByRole('button', { name: esSso['reauth.usePasskey'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(shared.errors.generic);
  });
});

describe('/sso/reauth with an invalid uid', () => {
  it.each([
    ['missing', '/sso/reauth'],
    ['bad characters', '/sso/reauth?uid=abc.def'],
    ['too long', `/sso/reauth?uid=${'a'.repeat(129)}`],
    ['encoded slash', '/sso/reauth?uid=a%2Fb'],
  ])('shows the error state with a link home (%s)', async (_label, path) => {
    const api = stubApi({ 'GET /me': jsonResponse(meFixture()) });
    const { container } = renderApp(path);
    expect(
      await screen.findByRole('heading', { level: 1, name: esSso['invalid.title'] }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: esSso['invalid.goHome'] })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByLabelText(new RegExp(`^${esSso['reauth.code']}`))).toBeNull();
    expect(api.callsTo('POST', '/auth/sso-reauth')).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('/sso/reauth session guard', () => {
  it('sends an anonymous visitor to the login keeping the interaction as return path', async () => {
    stubApi({ 'GET /me': problem(401, 'AUTHZ.SESSION') });
    const { router } = renderApp(PATH);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(router.state.location.search).toEqual({ returnTo: PATH });
  });
});
