import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadSsoCatalog } from '@iam/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es as shared } from '../../test/helpers';
import { renderApp } from '../../test/render-app';
import type * as FullPageNavigation from './api/full-page-navigation';

const catalog = await loadSsoCatalog();
const esSso = catalog['es-MX'];
const enSso = catalog['en-US'];

const navigation = vi.hoisted(() => ({ toProvider: vi.fn() }));
vi.mock('./api/full-page-navigation', async () => ({
  ...(await vi.importActual<typeof FullPageNavigation>('./api/full-page-navigation')),
  navigateToProvider: navigation.toProvider,
}));

const UID = 'aB3_-xYz09';
const PATH = `/sso/consent?uid=${UID}`;
const CONSENT_URL = `/oidc/interaction/${UID}/consent`;
const CLIENT = 'Acme CRM';

/** Con `redirect: 'manual'` el navegador entrega esto cuando el servidor responde 303. */
const opaqueRedirect = () => ({ type: 'opaqueredirect', status: 0, ok: false }) as Response;

const consentBody = (scopes: string[] = ['openid', 'profile', 'email', 'offline_access']) =>
  jsonResponse({ clientName: CLIENT, scopes });

const title = (client = CLIENT) => esSso['consent.title'].replace('{{client}}', client);
const allowButton = () => screen.getByRole('button', { name: esSso['consent.allow'] });
const denyButton = () => screen.getByRole('button', { name: esSso['consent.deny'] });

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** Llamadas de `fetch` a una URL, con su `init` (el stub de la API no registra credentials/redirect). */
function fetchCalls(url: string) {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => requestUrl(input) === url)
    .map(([, init]) => init);
}

beforeEach(() => {
  navigation.toProvider.mockReset();
});

describe('/sso/consent description', () => {
  it('names the application and lists the known permissions in plain language', async () => {
    stubApi({ 'GET /me': jsonResponse(meFixture()), [`GET ${CONSENT_URL}`]: consentBody() });
    const { container } = renderApp(PATH);

    expect(await screen.findByRole('heading', { level: 1, name: title() })).toHaveFocus();
    for (const scope of ['openid', 'profile', 'email', 'offline_access'] as const) {
      expect(screen.getByText(esSso[`scope.${scope}.label`])).toBeInTheDocument();
      expect(screen.getByText(esSso[`scope.${scope}.description`])).toBeInTheDocument();
    }
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('requests the interaction with the session cookie and shows unknown scopes verbatim in monospace', async () => {
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      [`GET ${CONSENT_URL}`]: consentBody(['openid', 'vault:read', 'openid']),
    });
    renderApp(PATH);
    const unknown = await screen.findByText('vault:read');
    expect(unknown).toHaveClass('font-mono');
    // El mismo permiso repetido se muestra una sola vez.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(fetchCalls(CONSENT_URL)[0]).toMatchObject({ credentials: 'same-origin' });
  });

  it('renders a client name with markup as plain text', async () => {
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      [`GET ${CONSENT_URL}`]: jsonResponse({ clientName: '<b>Evil</b>', scopes: ['openid'] }),
    });
    renderApp(PATH);
    expect(
      await screen.findByRole('heading', { level: 1, name: title('<b>Evil</b>') }),
    ).toBeInTheDocument();
  });
});

describe('/sso/consent decisions', () => {
  it.each([
    ['allow', allowButton],
    ['deny', denyButton],
  ] as const)(
    'posts %s without body, treats the opaque redirect as success and resumes the provider flow',
    async (decision, button) => {
      const user = userEvent.setup();
      const url = `${CONSENT_URL}/${decision}`;
      stubApi({
        'GET /me': jsonResponse(meFixture()),
        [`GET ${CONSENT_URL}`]: consentBody(),
        [`POST ${url}`]: opaqueRedirect,
      });
      renderApp(PATH);
      await screen.findByRole('heading', { level: 1, name: title() });

      await user.click(button());

      await waitFor(() => {
        expect(navigation.toProvider).toHaveBeenCalledWith(`/oidc/auth/${UID}`);
      });
      const [init] = fetchCalls(url);
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'manual',
      });
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toBeUndefined();
      expect(allowButton()).toBeDisabled();
      expect(denyButton()).toBeDisabled();
    },
  );

  it('disables both buttons while sending so the decision cannot be sent twice', async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      [`GET ${CONSENT_URL}`]: consentBody(),
      [`POST ${CONSENT_URL}/allow`]: () => pending,
    });
    renderApp(PATH);
    await screen.findByRole('heading', { level: 1, name: title() });

    await user.click(allowButton());
    await waitFor(() => {
      expect(allowButton()).toBeDisabled();
    });
    expect(denyButton()).toBeDisabled();
    await user.click(allowButton());
    expect(fetchCalls(`${CONSENT_URL}/allow`)).toHaveLength(1);

    release(opaqueRedirect());
    await waitFor(() => {
      expect(navigation.toProvider).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ['a 4xx response', () => problem(403, 'AUTHZ.FORBIDDEN')],
    ['a 5xx response', () => problem(500, 'INTERNAL')],
    [
      'a network failure',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('shows a generic error with retry after %s and does not navigate', async (_label, handler) => {
    const user = userEvent.setup();
    let attempt = 0;
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      [`GET ${CONSENT_URL}`]: consentBody(),
      [`POST ${CONSENT_URL}/allow`]: () => {
        attempt += 1;
        return attempt === 1 ? handler() : opaqueRedirect();
      },
    });
    const { container } = renderApp(PATH);
    await screen.findByRole('heading', { level: 1, name: title() });
    await user.click(allowButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/\S/);
    expect(navigation.toProvider).not.toHaveBeenCalled();
    expect(allowButton()).toBeEnabled();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('button', { name: shared.common['actions.retry'] }));
    await waitFor(() => {
      expect(navigation.toProvider).toHaveBeenCalledWith(`/oidc/auth/${UID}`);
    });
    expect(fetchCalls(`${CONSENT_URL}/allow`)).toHaveLength(2);
  });
});

describe('/sso/consent unavailable requests', () => {
  it('shows "no longer valid" with a link home when the provider answers 400', async () => {
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      [`GET ${CONSENT_URL}`]: problem(400, 'BAD_REQUEST'),
    });
    const { container } = renderApp(PATH);
    expect(
      await screen.findByRole('heading', { level: 1, name: esSso['consent.expiredTitle'] }),
    ).toHaveFocus();
    expect(screen.getByRole('link', { name: esSso['invalid.goHome'] })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByRole('button', { name: esSso['consent.allow'] })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers to retry the load after a server error', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      [`GET ${CONSENT_URL}`]: () => {
        attempt += 1;
        return attempt === 1 ? problem(500, 'INTERNAL') : consentBody();
      },
    });
    renderApp(PATH);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: shared.common['actions.retry'] }));
    expect(await screen.findByRole('heading', { level: 1, name: title() })).toBeInTheDocument();
  });

  it.each([
    ['missing', '/sso/consent'],
    ['bad characters', '/sso/consent?uid=abc.def'],
    ['too long', `/sso/consent?uid=${'a'.repeat(129)}`],
  ])('shows the error state and never calls the provider (%s)', async (_label, path) => {
    stubApi({ 'GET /me': jsonResponse(meFixture()) });
    renderApp(path);
    expect(
      await screen.findByRole('heading', { level: 1, name: esSso['invalid.title'] }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: esSso['invalid.goHome'] })).toBeVisible();
    expect(fetchCalls(CONSENT_URL)).toHaveLength(0);
  });
});

describe('/sso/consent in English', () => {
  it('renders the English catalog', async () => {
    stubApi({ 'GET /me': jsonResponse(meFixture()), [`GET ${CONSENT_URL}`]: consentBody() });
    renderApp(PATH, 'en-US');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: enSso['consent.title'].replace('{{client}}', CLIENT),
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: enSso['consent.allow'] })).toBeVisible();
    expect(screen.getByRole('button', { name: enSso['consent.deny'] })).toBeVisible();
    expect(screen.getByText(enSso['scope.email.label'])).toBeVisible();
  });
});
