import { ToastViewport, type ToastItem } from '@iam/ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

const DISMISS_AFTER_MS = 6000;

type ToastApi = { show: (message: string, tone?: ToastItem['tone']) => void };

const ToastContext = createContext<ToastApi | null>(null);

/** Estado del cierre automático de un aviso: el temporizador activo o, en pausa, el tiempo que le queda. */
type DismissTimer = {
  timerId: number | undefined;
  startedAt: number;
  remainingMs: number;
};

/**
 * Avisos efímeros globales (docs/frontend.md §5.2, Toast). El texto llega ya traducido.
 * El cierre automático se pausa mientras el puntero está encima o el foco dentro del aviso
 * (WCAG 2.2.1) y continúa con el tiempo restante al salir.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismissTimers = useRef(new Map<string, DismissTimer>());

  // Al desmontar se cancelan los temporizadores pendientes (sistema externo: el reloj).
  useEffect(() => {
    const pending = dismissTimers.current;
    return () => {
      for (const entry of pending.values()) {
        if (entry.timerId !== undefined) window.clearTimeout(entry.timerId);
      }
      pending.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const entry = dismissTimers.current.get(id);
    if (entry?.timerId !== undefined) window.clearTimeout(entry.timerId);
    dismissTimers.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const startTimer = useCallback(
    (id: string, entry: DismissTimer) => {
      entry.startedAt = Date.now();
      entry.timerId = window.setTimeout(() => {
        dismiss(id);
      }, entry.remainingMs);
    },
    [dismiss],
  );

  const changeHold = useCallback(
    (id: string, held: boolean) => {
      const entry = dismissTimers.current.get(id);
      if (entry === undefined) return;
      if (held && entry.timerId !== undefined) {
        window.clearTimeout(entry.timerId);
        entry.timerId = undefined;
        entry.remainingMs = Math.max(0, entry.remainingMs - (Date.now() - entry.startedAt));
      } else if (!held && entry.timerId === undefined) {
        startTimer(id, entry);
      }
    },
    [startTimer],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show: (message, tone = 'info') => {
        const id = crypto.randomUUID();
        setToasts((current) => [...current, { id, message, tone }]);
        const entry: DismissTimer = {
          timerId: undefined,
          startedAt: 0,
          remainingMs: DISMISS_AFTER_MS,
        };
        dismissTimers.current.set(id, entry);
        startTimer(id, entry);
      },
    }),
    [startTimer],
  );

  return (
    <ToastContext value={api}>
      {children}
      <ToastViewport
        toasts={toasts}
        onDismiss={dismiss}
        onHoldChange={changeHold}
        dismissLabel={t('toast.dismiss')}
        regionLabel={t('toast.region')}
      />
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
