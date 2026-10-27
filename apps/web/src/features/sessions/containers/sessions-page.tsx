import type { SessionSummary } from '@iam/contracts';
import { PageHeader, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { fetchMySessions, sessionsKeys } from '../api/sessions-api';
import { SessionsTable } from '../ui/sessions-table';

import { CloseSessionDialog } from './close-session-dialog';

/**
 * Container de `/sessions`: las sesiones propias con la `DataTable` estándar. Cerrar una sesión
 * ajena pide confirmación y, al terminar, recarga la lista (docs/frontend.md §7.3).
 */
export function SessionsPage() {
  const catalogReady = useLazyCatalog('sessions');
  const { t } = useTranslation(['sessions', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  const [closing, setClosing] = useState<SessionSummary | null>(null);

  const query = useQuery({
    queryKey: sessionsKeys.mine(),
    queryFn: ({ signal }) => fetchMySessions(signal),
    // Datos que cambian desde otros dispositivos: siempre se recargan al volver a la pantalla.
    staleTime: 0,
  });

  // Hasta que llegan los textos (descarga diferida) no se pinta nada con claves a medias.
  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'success';

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <SessionsTable
        sessions={query.data ?? []}
        status={status}
        errorMessage={errorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
        onClose={setClosing}
        timeZone={timeZone}
        refreshing={query.isFetching && !query.isPending}
      />
      {closing !== null ? (
        <CloseSessionDialog
          session={closing}
          onClose={() => {
            setClosing(null);
          }}
          onDone={() => {
            setClosing(null);
            toast.show(t('close.toast'), 'success');
            void queryClient.invalidateQueries({ queryKey: sessionsKeys.all });
          }}
        />
      ) : null}
    </>
  );
}
