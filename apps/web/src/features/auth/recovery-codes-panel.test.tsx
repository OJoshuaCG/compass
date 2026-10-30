import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('RecoveryCodesPanel download', () => {
  // jsdom no implementa estas APIs; se simulan para inspeccionar el Blob y su revocación.
  const URL_METHOD_NAMES = ['createObjectURL', 'revokeObjectURL'] as const;
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

  afterEach(() => {
    // Se restauran los descriptores originales (o se elimina la propiedad si jsdom no la tenía)
    // para no filtrar los mocks a otras pruebas del archivo.
    for (const name of URL_METHOD_NAMES) {
      const descriptor = originalDescriptors.get(name);
      if (descriptor) {
        Object.defineProperty(URL, name, descriptor);
      } else {
        Reflect.deleteProperty(URL, name);
      }
    }
    originalDescriptors.clear();
    vi.useRealTimers();
  });

  function mockObjectUrls() {
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:recovery-codes-test';
    });
    const revokeObjectURL = vi.fn();
    for (const name of URL_METHOD_NAMES) {
      originalDescriptors.set(name, Object.getOwnPropertyDescriptor(URL, name));
    }
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    // jsdom no navega al hacer clic en un enlace de descarga, pero se evita cualquier efecto.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      // Sin efecto.
    });
    return { blobs, createObjectURL, revokeObjectURL, clickSpy };
  }

  /**
   * Los temporizadores falsos se activan tras montar para no interferir con las esperas de RTL.
   * Con ellos se usa `fireEvent` y no `userEvent`: el envoltorio asíncrono de RTL solo detecta los
   * temporizadores falsos de Jest, y bajo los de Vitest `userEvent` se queda esperando para siempre.
   */
  function useFakeTimersForDownload() {
    vi.useFakeTimers();
  }

  it('downloads only the codes with a generic header and warning, then revokes the URL after a delay', async () => {
    const { blobs, createObjectURL, revokeObjectURL, clickSpy } = mockObjectUrls();
    renderPanel();
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });
    useFakeTimersForDownload();

    fireEvent.click(screen.getByRole('button', { name: es.auth['enroll.recovery.download'] }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Revocar de inmediato puede vaciar la descarga en Firefox y Safari.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovery-codes-test');
    const clickOrder = clickSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    const revokeOrder = revokeObjectURL.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY;
    expect(clickOrder).toBeLessThan(revokeOrder);
    // La lectura del Blob no debe depender de los temporizadores falsos.
    vi.useRealTimers();
    const blob = blobs[0];
    expect(blob?.type).toBe('text/plain;charset=utf-8');
    expect(await blob?.text()).toBe(
      [
        es.auth['enroll.recovery.file.header'],
        es.auth['enroll.recovery.file.warning'],
        '',
        ...CODES,
        '',
      ].join('\n'),
    );
    // Nada de enlaces residuales en el documento.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('still removes the link and revokes the URL after the delay when click() throws', async () => {
    const { revokeObjectURL, clickSpy } = mockObjectUrls();
    clickSpy.mockImplementation(() => {
      throw new Error('click failed');
    });
    renderPanel();
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });
    useFakeTimersForDownload();
    // React reporta el error del manejador como evento `error` de la ventana; un oyente propio
    // evita que el ejecutor de pruebas lo cuente como excepción no capturada.
    const reportedErrors: unknown[] = [];
    function captureError(event: ErrorEvent) {
      event.preventDefault();
      reportedErrors.push(event.error);
    }
    window.addEventListener('error', captureError);

    try {
      fireEvent.click(screen.getByRole('button', { name: es.auth['enroll.recovery.download'] }));
    } finally {
      window.removeEventListener('error', captureError);
    }

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(reportedErrors).toHaveLength(1);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovery-codes-test');
  });

  it('uses a fixed neutral file name', async () => {
    const user = userEvent.setup();
    const { clickSpy } = mockObjectUrls();
    renderPanel();
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });

    await user.click(screen.getByRole('button', { name: es.auth['enroll.recovery.download'] }));

    const link = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('recovery-codes.txt');
  });

  it('does not mark the codes as saved, keeps the leave protection and stores nothing', async () => {
    const user = userEvent.setup();
    mockObjectUrls();
    renderPanel();
    await screen.findByRole('list', { name: es.auth['enroll.recovery.list'] });

    await user.click(screen.getByRole('button', { name: es.auth['enroll.recovery.download'] }));

    expect(
      screen.getByRole('checkbox', { name: es.auth['enroll.recovery.saved'] }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: es.auth['enroll.recovery.continue'] }),
    ).toBeDisabled();
    // El aviso al salir sigue armado.
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
