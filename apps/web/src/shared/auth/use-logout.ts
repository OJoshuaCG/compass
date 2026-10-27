import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { apiClient, noContentSchema, useAsyncAction } from '../api';
import { useToast } from '../toast';

import { announceSessionEnded } from './session-sync';

/**
 * Cierra la sesión en el servidor y descarta TODO el estado local (caché de Query incluida:
 * puede contener datos de la sesión anterior). Si el servidor no confirma, la sesión sigue
 * viva, así que no se finge un cierre: se avisa y se conserva el estado.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const { t } = useTranslation('common');
  const action = useAsyncAction(() => apiClient.post('/auth/logout', noContentSchema));

  return {
    pending: action.pending,
    logout: async () => {
      const result = await action.run();
      if (!result.ok) {
        toast.show(t('actions.logoutFailed'), 'danger');
        return;
      }
      // Las demás pestañas dejan el área autenticada; solo viaja el nombre del evento.
      announceSessionEnded();
      queryClient.clear();
      await router.navigate({ to: '/login' });
    },
  };
}
