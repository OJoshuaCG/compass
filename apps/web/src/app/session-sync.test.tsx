import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { emitSessionExpired } from '../shared/api';
import { SESSION_CHANNEL, SESSION_ENDED_EVENT } from '../shared/auth/session-sync';
import { FakeBroadcastChannel } from '../test/fake-broadcast-channel';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../test/fake-api';
import { es } from '../test/helpers';
import { renderApp } from '../test/render-app';

/** "Otra pestaña": una instancia independiente del mismo canal. */
function otherTab() {
  const channel = new FakeBroadcastChannel(SESSION_CHANNEL);
  const received: unknown[] = [];
  channel.onmessage = (event) => {
    received.push(event.data);
  };
  return { channel, received };
}

/** `/me` deja de reconocer la sesión en cuanto el servidor la cierra, como en la realidad. */
function loggedInApi() {
  let open = true;
  return stubApi({
    'GET /me': () => (open ? jsonResponse(meFixture()) : problem(401, 'AUTHZ.SESSION')),
    'POST /auth/logout': () => {
      open = false;
      return noContent();
    },
  });
}

describe('cross-tab session sync', () => {
  it('logging out announces only the event name to other tabs', async () => {
    const user = userEvent.setup();
    loggedInApi();
    const { router } = renderApp('/');
    const tab = otherTab();
    await user.click(await screen.findByRole('button', { name: es.common['actions.logout'] }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    await waitFor(() => {
      expect(tab.received).toEqual([SESSION_ENDED_EVENT]);
    });
    // Nada más que el nombre del evento viajó por el canal.
    expect(FakeBroadcastChannel.posted).toEqual([SESSION_ENDED_EVENT]);
  });

  it('a failed logout announces nothing (the session is still alive)', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /me': jsonResponse(meFixture()),
      'POST /auth/logout': problem(500, 'INTERNAL'),
    });
    renderApp('/');
    const tab = otherTab();
    await user.click(await screen.findByRole('button', { name: es.common['actions.logout'] }));
    await screen.findByText(es.common['actions.logoutFailed']);
    expect(tab.received).toEqual([]);
  });

  it('another tab leaves the authenticated area and goes to /login when it hears the event', async () => {
    let open = true;
    stubApi({
      'GET /me': () => (open ? jsonResponse(meFixture()) : problem(401, 'AUTHZ.SESSION')),
    });
    const { router, queryClient } = renderApp('/users');
    await screen.findByRole('heading', { level: 1, name: es.directory['users.title'] });
    expect(queryClient.getQueryCache().findAll({ queryKey: ['directory'] }).length).toBeGreaterThan(
      0,
    );
    const sender = new FakeBroadcastChannel(SESSION_CHANNEL);
    open = false;
    sender.postMessage(SESSION_ENDED_EVENT);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    // Se descartó el estado en caché de la sesión anterior.
    expect(queryClient.getQueryCache().findAll({ queryKey: ['directory'] })).toHaveLength(0);
    expect(queryClient.getQueryData(['session', 'me'])).toEqual({ kind: 'anonymous' });
  });

  it('ignores any other message', async () => {
    stubApi({ 'GET /me': jsonResponse(meFixture()) });
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: es.common['home.title'] });
    const sender = new FakeBroadcastChannel(SESSION_CHANNEL);
    sender.postMessage('something.else');
    sender.postMessage({ type: SESSION_ENDED_EVENT });
    await act(async () => {
      await Promise.resolve();
    });
    expect(router.state.location.pathname).toBe('/');
  });

  it('does not pull a tab that is not in the authenticated area (public screens keep their state)', async () => {
    stubApi({ 'GET /me': problem(401, 'AUTHZ.SESSION') });
    const { router } = renderApp('/invitation?token=abc');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invitation');
    });
    new FakeBroadcastChannel(SESSION_CHANNEL).postMessage(SESSION_ENDED_EVENT);
    await act(async () => {
      await Promise.resolve();
    });
    expect(router.state.location.pathname).toBe('/invitation');
  });

  it('a 401 in this tab announces the loss once and does not echo it back', async () => {
    let open = true;
    stubApi({
      'GET /me': () => (open ? jsonResponse(meFixture()) : problem(401, 'AUTHZ.SESSION')),
    });
    const { router } = renderApp('/users');
    await screen.findByRole('heading', { level: 1, name: es.directory['users.title'] });
    const tab = otherTab();
    open = false;
    act(() => {
      emitSessionExpired();
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    await waitFor(() => {
      expect(tab.received).toEqual([SESSION_ENDED_EVENT]);
    });
    expect(FakeBroadcastChannel.posted).toEqual([SESSION_ENDED_EVENT]);
  });

  it('the session query answering 401 after being authenticated announces the loss', async () => {
    let authenticated = true;
    stubApi({
      'GET /me': () => (authenticated ? jsonResponse(meFixture()) : problem(401, 'AUTHZ.SESSION')),
    });
    const { queryClient } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: es.common['home.title'] });
    const tab = otherTab();
    authenticated = false;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    });
    await waitFor(() => {
      expect(tab.received).toEqual([SESSION_ENDED_EVENT]);
    });
  });

  it('a first anonymous visit (no previous session) announces nothing', async () => {
    stubApi({ 'GET /me': problem(401, 'AUTHZ.SESSION') });
    const { router } = renderApp('/');
    const tab = otherTab();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(tab.received).toEqual([]);
  });

  it('does nothing when BroadcastChannel is missing', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const user = userEvent.setup();
    loggedInApi();
    const { router } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: es.common['actions.logout'] }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(FakeBroadcastChannel.posted).toEqual([]);
  });
});
