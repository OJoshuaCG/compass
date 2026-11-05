import { PageHeader, Spinner } from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useClientPagination } from '../../../shared/lib';
import { fetchInboundViews, inboundKeys } from '../api/inbound-api';
import { InboundViewsTable } from '../ui/inbound-views-table';

/**
 * Container de `/inbound`: las vistas que la persona puede leer, con la `DataTable` estándar.
 * El servidor entrega el listado completo (tope de 200), por eso se pagina en memoria.
 */
export function InboundViewsPage() {
  const catalogReady = useLazyCatalog('inbound');
  const { t } = useTranslation(['inbound', 'common']);
  const errorMessage = useErrorMessage();

  // El acceso puede cambiar desde otra pestaña o persona: siempre se recarga al volver.
  const query = useQuery({
    queryKey: inboundKeys.views(),
    queryFn: ({ signal }) => fetchInboundViews(signal),
    staleTime: 0,
  });
  const paging = useClientPagination(query.data ?? []);
  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'success';

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  return (
    <>
      <PageHeader
        title={t('title', { ns: 'inbound' })}
        description={t('description', { ns: 'inbound' })}
      />
      <InboundViewsTable
        views={paging.pageRows}
        status={status}
        errorMessage={errorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
        paging={paging}
      />
    </>
  );
}
