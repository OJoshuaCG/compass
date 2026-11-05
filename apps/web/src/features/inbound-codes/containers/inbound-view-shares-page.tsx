import type { InboundViewShare } from '@iam/contracts';
import { Button, PageHeader, Spinner } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe, usePermission } from '../../../shared/auth';
import { ErrorAlert, useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { SharesTable } from '../../shares';
import {
  fetchInboundConfigurableViews,
  fetchInboundViewShares,
  inboundKeys,
} from '../api/inbound-api';
import { canManageViewShares } from '../model/inbound-view-model';

import { RevokeInboundViewShareDialog } from './revoke-inbound-view-share-dialog';
import { ShareInboundViewDialog } from './share-inbound-view-dialog';

type DialogState = { kind: 'share' } | { kind: 'revoke'; share: InboundViewShare } | null;

export type InboundViewSharesPageProps = {
  viewId: string;
};

/**
 * Container de `/inbound/views/:viewId/shares`: con quién se comparte una vista de códigos, en la
 * `DataTable` estándar. Compartir y revocar se ofrecen con el permiso `share.manage` y MANAGE sobre la
 * vista; solo es comodidad, el servidor decide siempre. El nombre y el nivel de la vista salen del
 * listado de vistas configurables, porque la API no expone una vista suelta.
 */
export function InboundViewSharesPage({ viewId }: InboundViewSharesPageProps) {
  const inboundReady = useLazyCatalog('inbound');
  // La tabla y el formulario de compartir son del feature `shares` y usan su catálogo.
  const sharesReady = useLazyCatalog('shares');
  const { t } = useTranslation(['inbound', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  const hasSharePermission = usePermission('share.manage');
  const [dialog, setDialog] = useState<DialogState>(null);

  // El nivel y los accesos pueden cambiar desde otra pestaña o persona: siempre se recargan al volver.
  const viewsQuery = useQuery({
    queryKey: inboundKeys.configurableViews(),
    queryFn: ({ signal }) => fetchInboundConfigurableViews(signal),
    staleTime: 0,
  });
  const view = viewsQuery.data?.find((candidate) => candidate.id === viewId);
  const allowManage = view !== undefined && canManageViewShares(hasSharePermission, view);
  // El servidor solo lista los accesos con las dos llaves (`share.manage` y MANAGE sobre la vista):
  // sin ellas la petición fallaría siempre y cada intento dejaría una negación en la auditoría.
  const sharesQuery = useQuery({
    queryKey: inboundKeys.viewShares(viewId),
    queryFn: ({ signal }) => fetchInboundViewShares(viewId, signal),
    enabled: allowManage,
    staleTime: 0,
  });

  if (!inboundReady || !sharesReady || viewsQuery.isPending) {
    return <Spinner label={t('state.loading', { ns: 'common' })} />;
  }

  const backLink = (
    <Link
      to="/inbound/view-settings"
      className="inline-flex min-h-6 items-center text-sm text-accent underline underline-offset-4"
    >
      {t('viewSettings.shares.back', { ns: 'inbound' })}
    </Link>
  );

  if (viewsQuery.isError) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <ErrorAlert
          error={viewsQuery.error}
          onRetry={() => {
            void viewsQuery.refetch();
          }}
        />
      </div>
    );
  }

  // Una vista archivada, ajena o inexistente no aparece en el listado: se responde igual en los tres
  // casos para no revelar cuál es. Sin las dos llaves tampoco hay accesos que mostrar, y el mismo texto
  // ("no la encontramos o ya no la administras") cubre ese caso.
  if (view === undefined || !allowManage) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <p className="text-sm text-text-secondary">
          {t('viewSettings.shares.notFound', { ns: 'inbound' })}
        </p>
      </div>
    );
  }

  const close = () => {
    setDialog(null);
  };
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: inboundKeys.viewShares(viewId) });
  };
  // Solo cierra el diálogo que terminó: una respuesta tardía de un diálogo ya cerrado no debe cerrar
  // otro que la persona abrió después.
  const done = (kind: NonNullable<DialogState>['kind'], message: string) => {
    toast.show(message, 'success');
    setDialog((current) => (current?.kind === kind ? null : current));
    reload();
  };

  const tableStatus = sharesQuery.isPending ? 'loading' : sharesQuery.isError ? 'error' : 'success';

  return (
    <>
      {backLink}
      <PageHeader
        title={t('viewSettings.shares.title', { ns: 'inbound', name: view.name })}
        description={t('viewSettings.shares.description', { ns: 'inbound' })}
        actions={
          <Button
            onClick={() => {
              setDialog({ kind: 'share' });
            }}
          >
            {t('viewSettings.shares.open', { ns: 'inbound' })}
          </Button>
        }
      />
      <SharesTable<InboundViewShare>
        shares={sharesQuery.data ?? []}
        status={tableStatus}
        errorMessage={errorMessage(sharesQuery.error)}
        onRetry={() => {
          void sharesQuery.refetch();
        }}
        timeZone={timeZone}
        // Aquí solo se llega con las dos llaves (si no, la página responde "no encontrada").
        canRevoke
        onRevoke={(share) => {
          setDialog({ kind: 'revoke', share });
        }}
        copy={{
          caption: t('viewSettings.shares.caption', { ns: 'inbound' }),
          emptyTitle: t('viewSettings.shares.empty.title', { ns: 'inbound' }),
          emptyDescription: t('viewSettings.shares.empty.description', { ns: 'inbound' }),
        }}
      />
      {dialog?.kind === 'share' ? (
        <ShareInboundViewDialog
          view={view}
          onClose={close}
          onShared={(granteeName) => {
            done(
              'share',
              t('viewSettings.shares.share.toast', { ns: 'inbound', name: granteeName }),
            );
          }}
        />
      ) : null}
      {dialog?.kind === 'revoke' ? (
        <RevokeInboundViewShareDialog
          share={dialog.share}
          onClose={close}
          onStale={() => {
            // El acceso o la vista ya no existen para esta persona: se recargan ambos listados.
            reload();
            void queryClient.invalidateQueries({ queryKey: inboundKeys.configurableViews() });
          }}
          onDone={() => {
            done(
              'revoke',
              t('viewSettings.shares.revoke.toast', {
                ns: 'inbound',
                name: dialog.share.granteeName,
              }),
            );
          }}
        />
      ) : null}
    </>
  );
}
