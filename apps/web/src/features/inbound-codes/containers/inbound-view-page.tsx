import { PageHeader, Spinner } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { fetchInboundViews, inboundKeys } from '../api/inbound-api';

import { InboundCodesPanel } from './inbound-codes-panel';
import { InboundHistoryPanel } from './inbound-history-panel';

export type InboundViewPageProps = {
  viewId: string;
};

/**
 * Container de `/inbound/views/:viewId`: los códigos vigentes y el historial de una vista. El
 * nombre y la fuente salen del listado de vistas (no hay un endpoint de detalle); si la vista no
 * aparece ahí, la pantalla usa un título genérico y deja que el servidor decida el acceso.
 */
export function InboundViewPage({ viewId }: InboundViewPageProps) {
  const catalogReady = useLazyCatalog('inbound');
  const { t } = useTranslation(['inbound', 'common']);

  const viewsQuery = useQuery({
    queryKey: inboundKeys.views(),
    queryFn: ({ signal }) => fetchInboundViews(signal),
    staleTime: 0,
  });

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const view = viewsQuery.data?.find((candidate) => candidate.id === viewId);

  return (
    <>
      <Link
        to="/inbound"
        className="inline-flex min-h-6 items-center text-sm text-accent underline underline-offset-4"
      >
        {t('back', { ns: 'inbound' })}
      </Link>
      <PageHeader
        title={view === undefined ? t('view.title', { ns: 'inbound' }) : view.name}
        description={
          view === undefined
            ? t('view.description', { ns: 'inbound' })
            : t('view.descriptionWithSource', { ns: 'inbound', source: view.sourceDisplayName })
        }
      />
      <InboundCodesPanel key={viewId} viewId={viewId} />
      <InboundHistoryPanel key={`history-${viewId}`} viewId={viewId} />
    </>
  );
}
