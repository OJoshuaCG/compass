import { ReauthDialog } from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  apiClient,
  noContentSchema,
  reauthCoordinator,
  useAsyncAction,
  useRateLimitCooldown,
} from '../api';
import { useErrorMessage } from '../i18n';

import { sessionKeys } from './session';

/**
 * Monta el diálogo de reautenticación (step-up) una sola vez en la raíz. Se abre cuando el
 * cliente HTTP recibe `AUTHZ.REAUTH_REQUIRED`; al reautenticar, el cliente reintenta la
 * operación una vez. El código TOTP vive solo en el estado del diálogo.
 */
export function ReauthHost() {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const open = useSyncExternalStore(reauthCoordinator.subscribe, reauthCoordinator.isOpen);

  const submit = useAsyncAction((code: string) =>
    apiClient.post('/auth/reauth', noContentSchema, { body: { code }, skipReauth: true }),
  );
  const cooldown = useRateLimitCooldown(submit.error);

  const { reset } = submit;

  // Si la solicitud se cierra por otra vía (sesión expirada, cancelación) se descarta cualquier
  // envío en vuelo y su error: el siguiente diálogo empieza limpio y puede volver a enviar.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Si la app se desmonta con una petición pendiente, se cancela para no dejar promesas colgadas.
  useEffect(() => {
    return () => {
      reauthCoordinator.settle(false);
    };
  }, []);

  return (
    <ReauthDialog
      open={open}
      labels={{
        title: t('reauth.title'),
        description: t('reauth.description'),
        codeLabel: t('reauth.code'),
        submit: t('reauth.submit'),
        cancel: t('actions.cancel'),
        close: t('dialog.close'),
      }}
      loading={submit.pending}
      disabled={cooldown.secondsLeft > 0}
      errorMessage={submit.error === undefined ? undefined : errorMessage(submit.error)}
      cooldownLabel={
        cooldown.secondsLeft > 0
          ? t('retryIn', { ns: 'errors', seconds: cooldown.secondsLeft })
          : undefined
      }
      onSubmit={(code) => {
        // El envío queda atado a la solicitud abierta ahora: si se cancela, su resultado tardío
        // no puede liberar otra solicitud.
        const requestId = reauthCoordinator.currentId();
        if (requestId === null) return;
        void submit.run(code).then((result) => {
          if (!result.ok) return;
          // `reauthUntil` cambió: se refresca `/me` y se libera a las peticiones en espera.
          void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
          reauthCoordinator.settle(true, requestId);
        });
      }}
      onCancel={() => {
        reset();
        reauthCoordinator.settle(false);
      }}
    />
  );
}
