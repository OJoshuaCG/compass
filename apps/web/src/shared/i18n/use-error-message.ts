import { knownErrorKey } from '@iam/i18n';
import { useTranslation } from 'react-i18next';

import { ApiError, NETWORK_ERROR_CODE } from '../api';

/**
 * Traduce un error a un mensaje para el usuario con la clave derivada de su código
 * (docs/frontend.md §10). Si el código no está en el catálogo usa el mensaje genérico y
 * deja constancia en consola (solo el código, nunca datos de la respuesta).
 */
export function useErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation('errors');
  return (error) => {
    if (error instanceof ApiError) {
      if (error.code === NETWORK_ERROR_CODE) return t('network');
      const { key, known } = knownErrorKey(error.code);
      if (!known) console.warn(`Unknown API error code: ${error.code}`);
      const message = t(key);
      return error.requestId === undefined
        ? message
        : `${message} ${t('requestId', { requestId: error.requestId })}`;
    }
    return t('generic');
  };
}
