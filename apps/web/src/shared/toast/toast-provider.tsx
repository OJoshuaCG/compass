import { ToastViewport, type ToastItem } from '@iam/ui';
import {
  createContext,
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

/** Avisos efímeros globales (docs/frontend.md §5.2, Toast). El texto llega ya traducido. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Set<number>());

  // Al desmontar se cancelan los temporizadores pendientes (sistema externo: el reloj).
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
    };
  }, []);

  const api = useMemo<ToastApi>(() => {
    const dismiss = (id: string) => {
      setToasts((current) => current.filter((item) => item.id !== id));
    };
    return {
      show: (message, tone = 'info') => {
        const id = crypto.randomUUID();
        setToasts((current) => [...current, { id, message, tone }]);
        const timer = window.setTimeout(() => {
          timers.current.delete(timer);
          dismiss(id);
        }, DISMISS_AFTER_MS);
        timers.current.add(timer);
      },
    };
  }, []);

  return (
    <ToastContext value={api}>
      {children}
      <ToastViewport
        toasts={toasts}
        onDismiss={(id) => {
          setToasts((current) => current.filter((item) => item.id !== id));
        }}
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
