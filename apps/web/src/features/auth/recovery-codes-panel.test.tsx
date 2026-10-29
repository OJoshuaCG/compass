import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '../../shared/i18n';
import { es } from '../../test/helpers';
import { RecoveryCodesPanel } from './ui/recovery-codes-panel';

const CODES = Array.from({ length: 3 }, (_, i) => `RC${String(i)}A-B7K9Q2ZX`);

/** Panel dentro de un router en memoria con una ruta de destino a la que intentar salir. */
function renderPanel(onContinue: () => void = () => undefined) {
  const rootRoute = createRootRoute();
  const panelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/enroll',
    component: () => <RecoveryCodesPanel codes={CODES} onContinue={onContinue} />,
  });
  const elsewhereRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/elsewhere',
    component: () => <p>destination</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([panelRoute, elsewhereRoute]),
    history: createMemoryHistory({ initialEntries: ['/enroll'] }),
  });
  const view = render(
    <I18nextProvider i18n={createI18n('es-MX')}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return { router, ...view };
}

function beforeUnloadCalls(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter(([type]) => type === 'beforeunload').length;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecoveryCodesPanel leave protection', () => {
  it('opens the dialog on navigation and "stay" keeps the page and the codes', async () => {
    const user = userEvent.setup();
    const { router } = renderPanel();
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });

    router.history.push('/elsewhere');

    const dialog = await screen.findByRole('dialog', {
      name: es.auth['enroll.recovery.leave.title'],
    });
    await user.click(screen.getByRole('button', { name: es.auth['enroll.recovery.leave.stay'] }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(dialog).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/enroll');
    for (const code of CODES) expect(screen.getByText(code)).toBeInTheDocument();
  });

  it('lets the person leave after explicitly confirming', async () => {
    const user = userEvent.setup();
    const { router } = renderPanel();
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });

    router.history.push('/elsewhere');
    await screen.findByRole('dialog', { name: es.auth['enroll.recovery.leave.title'] });
    await user.click(
      screen.getByRole('button', { name: es.auth['enroll.recovery.leave.confirm'] }),
    );

    await screen.findByText('destination');
    expect(router.state.location.pathname).toBe('/elsewhere');
  });

  it('does not block nor warn once the codes are marked as saved', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const { router } = renderPanel(onContinue);
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);

    await user.click(screen.getByRole('checkbox', { name: es.auth['enroll.recovery.saved'] }));
    await user.click(screen.getByRole('button', { name: es.auth['enroll.recovery.continue'] }));
    expect(onContinue).toHaveBeenCalledTimes(1);

    // Sin listener activo el evento no se cancela.
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);

    router.history.push('/elsewhere');
    await screen.findByText('destination');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/elsewhere');
  });

  it('re-arms the protection when the "saved" checkbox is unchecked again', async () => {
    const user = userEvent.setup();
    const { router } = renderPanel();
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });
    const savedCheckbox = screen.getByRole('checkbox', { name: es.auth['enroll.recovery.saved'] });

    await user.click(savedCheckbox);
    // Marcada: sin protección activa (precondición para que el desmarcado sea significativo).
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);

    await user.click(savedCheckbox);
    expect(savedCheckbox).not.toBeChecked();

    // Un arrepentimiento debe devolver la protección: si no, se perderían los códigos sin aviso.
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);

    router.history.push('/elsewhere');
    await screen.findByRole('dialog', { name: es.auth['enroll.recovery.leave.title'] });
    expect(router.state.location.pathname).toBe('/enroll');
  });

  it('treats Escape on the leave dialog as "stay": keeps the route and the codes', async () => {
    const user = userEvent.setup();
    const { router } = renderPanel();
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });

    router.history.push('/elsewhere');
    await screen.findByRole('dialog', { name: es.auth['enroll.recovery.leave.title'] });
    await user.keyboard('{Escape}');

    // Escape nunca debe contar como confirmar la salida: es la vía por defecto del teclado.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.state.location.pathname).toBe('/enroll');
    expect(screen.queryByText('destination')).toBeNull();
    for (const code of CODES) expect(screen.getByText(code)).toBeInTheDocument();
  });

  it('registers beforeunload only while unsaved and removes the same listener on unmount', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderPanel();
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });

    expect(beforeUnloadCalls(addSpy)).toBe(1);
    const registered = addSpy.mock.calls.find(([type]) => type === 'beforeunload')?.[1];
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('beforeunload', registered);
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
  });
});
