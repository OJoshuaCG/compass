import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, meFixture, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

import { readStoredSidebarVisible, sidebarStorageKey } from './sidebar-storage';

const ME = meFixture();
const PERSON_ID = ME.user.id;

function setup() {
  stubApi({
    'GET /me': jsonResponse(ME),
    'GET /users/managed': jsonResponse({ data: [], page: { nextCursor: null, limit: 100 } }),
    'GET /me/sessions': jsonResponse({ data: [], page: { nextCursor: null, limit: 100 } }),
  });
}

const navigationName = es.common['nav.label'];

describe('collapsible sidebar', () => {
  // Se restaura aquí y no al final de cada prueba: si una aserción falla, el stub de matchMedia no
  // debe filtrarse a las pruebas siguientes.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is visible by default and exposes the toggle state', async () => {
    setup();
    renderApp('/');
    const toggle = await screen.findByRole('button', { name: es.common['nav.hideMenu'] });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar');
    expect(screen.getByRole('navigation', { name: navigationName })).toBeInTheDocument();
  });

  it('hides and shows the menu and remembers the choice for that person', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: es.common['nav.hideMenu'] }));
    expect(screen.queryByRole('navigation', { name: navigationName })).not.toBeInTheDocument();
    const showButton = screen.getByRole('button', { name: es.common['nav.showMenu'] });
    expect(showButton).toHaveAttribute('aria-expanded', 'false');
    expect(readStoredSidebarVisible(PERSON_ID)).toBe(false);
    expect(window.localStorage.getItem(sidebarStorageKey(PERSON_ID))).toBe('hidden');
    await user.click(showButton);
    expect(screen.getByRole('navigation', { name: navigationName })).toBeInTheDocument();
    expect(readStoredSidebarVisible(PERSON_ID)).toBe(true);
  });

  it('starts hidden when that person had hidden it before', async () => {
    window.localStorage.setItem(sidebarStorageKey(PERSON_ID), 'hidden');
    setup();
    renderApp('/');
    expect(
      await screen.findByRole('button', { name: es.common['nav.showMenu'] }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: navigationName })).not.toBeInTheDocument();
  });

  it("does not apply another person's choice", async () => {
    window.localStorage.setItem(sidebarStorageKey('otra-persona'), 'hidden');
    setup();
    renderApp('/');
    expect(
      await screen.findByRole('button', { name: es.common['nav.hideMenu'] }),
    ).toBeInTheDocument();
  });

  it('keeps working when the storage is blocked', async () => {
    const user = userEvent.setup();
    setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: es.common['nav.hideMenu'] }));
    expect(screen.queryByRole('navigation', { name: navigationName })).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('starts folded on narrow screens when nothing was stored', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    setup();
    renderApp('/');
    expect(
      await screen.findByRole('button', { name: es.common['nav.showMenu'] }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(sidebarStorageKey(PERSON_ID))).toBeNull();
  });

  it('closes the drawer after following a link on narrow screens and never saves the choice', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: es.common['nav.showMenu'] }));
    await user.click(screen.getByRole('link', { name: es.common['nav.sessions'] }));
    expect(
      await screen.findByRole('button', { name: es.common['nav.showMenu'] }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: navigationName })).not.toBeInTheDocument();
    // En pantallas estrechas el panel es un gesto del momento: nada se guarda ni al abrir ni al cerrar.
    expect(window.localStorage.getItem(sidebarStorageKey(PERSON_ID))).toBeNull();
  });

  it('opens the menu as a modal drawer on narrow screens and closes it with Escape', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    setup();
    renderApp('/');
    const toggle = await screen.findByRole('button', { name: es.common['nav.showMenu'] });
    await user.click(toggle);
    const drawer = await screen.findByRole('dialog', { name: navigationName });
    expect(drawer).toContainElement(screen.getByRole('navigation', { name: navigationName }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
    expect(screen.queryByRole('navigation', { name: navigationName })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(sidebarStorageKey(PERSON_ID))).toBeNull();
  });

  it('ignores a stored "visible" choice on narrow screens', async () => {
    window.localStorage.setItem(sidebarStorageKey(PERSON_ID), 'visible');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    setup();
    renderApp('/');
    expect(
      await screen.findByRole('button', { name: es.common['nav.showMenu'] }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the menu open after following a link on wide screens', async () => {
    const user = userEvent.setup();
    setup();
    renderApp('/');
    await user.click(await screen.findByRole('link', { name: es.common['nav.sessions'] }));
    expect(screen.getByRole('navigation', { name: navigationName })).toBeInTheDocument();
  });
});
