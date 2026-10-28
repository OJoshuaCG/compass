import { passkeySchema } from '@iam/contracts';
import { ReauthDialog } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  apiClient,
  noContentSchema,
  reauthCoordinator,
  useAsyncAction,
  useRateLimitCooldown,
} from '../api';
import { useErrorMessage } from '../i18n';

import { reauthenticateWithPasskey } from './passkey-reauth';
import { sessionKeys } from './session';

// Misma clave y forma que la lista de la pantalla de seguridad: comparten caché sin importarse.
const MY_PASSKEYS_KEY = ['passkeys', 'mine'] as const;
const passkeysResponseSchema = z.object({ data: z.array(passkeySchema) });

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
  const passkeySubmit = useAsyncAction(reauthenticateWithPasskey);
  const cooldown = useRateLimitCooldown(submit.error ?? passkeySubmit.error);

  // La llave solo se ofrece a quien tiene alguna: así no se pide un desafío que fallaría y quedaría
  // auditado como intento fallido.
  const passkeys = useQuery({
    queryKey: MY_PASSKEYS_KEY,
    queryFn: async ({ signal }) =>
      (await apiClient.get('/me/passkeys', passkeysResponseSchema, { signal })).data,
    enabled: open,
  });
  const hasPasskeys = (passkeys.data?.length ?? 0) > 0;

  const { reset } = submit;
  const { reset: resetPasskey } = passkeySubmit;

  // Si la solicitud se cierra por otra vía (sesión expirada, cancelación) se descarta cualquier
  // envío en vuelo y su error: el siguiente diálogo empieza limpio y puede volver a enviar.
  useEffect(() => {
    if (!open) {
      reset();
      resetPasskey();
    }
  }, [open, reset, resetPasskey]);

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
      disabled={cooldown.secondsLeft > 0 || passkeySubmit.pending}
      errorMessage={
        submit.error !== undefined
          ? errorMessage(submit.error)
          : passkeySubmit.error === undefined
            ? undefined
            : errorMessage(passkeySubmit.error)
      }
      passkey={
        hasPasskeys
          ? {
              label: t('reauth.passkey'),
              loading: passkeySubmit.pending,
              onUse: () => {
                const requestId = reauthCoordinator.currentId();
                if (requestId === null) return;
                void passkeySubmit.run().then((result) => {
                  // Cancelar la solicitud del navegador no es un error: el diálogo sigue abierto.
                  if (!result.ok || result.value === 'cancelled') return;
                  void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
                  reauthCoordinator.settle(true, requestId);
                });
              },
            }
          : undefined
      }
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
