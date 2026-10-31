import { Alert, Button } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { useErrorMessage } from './use-error-message';

export type ErrorAlertProps = {
  error: unknown;
  /** Segundos de espera de un 429; el aviso los muestra y el llamador deshabilita el envío. */
  secondsLeft?: number;
  /** Si se da, se ofrece "Reintentar" (útil en errores de red y 5xx). */
  onRetry?: () => void;
};

/**
 * Aviso de error de una operación (docs/frontend.md §7.2): mensaje traducido por `code`, con
 * `requestId` visible para soporte (lo agrega `useErrorMessage`) y la espera de un 429.
 */
export function ErrorAlert({ error, secondsLeft = 0, onRetry }: ErrorAlertProps) {
  const { t } = useTranslation(['common', 'errors']);
  const message = useErrorMessage();
  return (
    <div className="flex flex-col gap-2">
      <Alert
        tone="danger"
        action={
          onRetry === undefined ? undefined : (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {t('actions.retry', { ns: 'common' })}
            </Button>
          )
        }
      >
        {message(error)}
      </Alert>
      {/* La cuenta regresiva vive fuera del `role="alert"`: dentro, cada segundo re-anunciaría el
          aviso completo. `role="timer"` es no asertivo (aria-live="off" implícito), así el
          lector de pantalla dice el error una vez y el contador sigue visible. */}
      {secondsLeft > 0 ? (
        <p role="timer" aria-live="off" className="text-sm text-text-secondary">
          {t('retryIn', { ns: 'errors', seconds: secondsLeft })}
        </p>
      ) : null}
    </div>
  );
}
