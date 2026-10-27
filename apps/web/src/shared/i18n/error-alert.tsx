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
      {secondsLeft > 0 ? ` ${t('retryIn', { ns: 'errors', seconds: secondsLeft })}` : null}
    </Alert>
  );
}
