import type { InboundSourceSummary } from '@iam/contracts';
import { Button, PageHeader, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useClientPagination } from '../../../shared/lib';
import { useToast } from '../../../shared/toast';
import { fetchInboundSources, inboundKeys } from '../api/inbound-api';
import { InboundSourcesTable } from '../ui/inbound-sources-table';

import { ArchiveInboundSourceDialog } from './archive-inbound-source-dialog';
import { CreateInboundSourceDialog } from './create-inbound-source-dialog';
import { InboundSourceConnectionDialog } from './inbound-source-connection-dialog';
import { RenameInboundSourceDialog } from './rename-inbound-source-dialog';

type DialogState =
  | { kind: 'rename' | 'connection' | 'archive'; source: InboundSourceSummary }
  | { kind: 'create' }
  | null;

/**
 * Container de `/inbound/sources`: las fuentes de correo con la `DataTable` estándar. Crear,
 * renombrar, configurar la conexión y archivar se ofrecen según el nivel de cada fila; tras cada cambio se recargan las
 * fuentes y las vistas (archivar una fuente oculta sus vistas).
 */
export function InboundSourcesPage() {
  const catalogReady = useLazyCatalog('inbound');
  const { t } = useTranslation(['inbound', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  const [dialog, setDialog] = useState<DialogState>(null);

  // El nivel puede cambiar desde otra pestaña o persona: siempre se recarga al volver.
  const query = useQuery({
    queryKey: inboundKeys.sources(),
    queryFn: ({ signal }) => fetchInboundSources(signal),
    staleTime: 0,
  });
  const paging = useClientPagination(query.data ?? []);
  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'success';

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const close = () => {
    setDialog(null);
  };
  const done = (message: string) => {
    toast.show(message, 'success');
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: inboundKeys.sources() });
    void queryClient.invalidateQueries({ queryKey: inboundKeys.views() });
  };

  return (
    <>
      <PageHeader
        eyebrow={t('nav.group.vault', { ns: 'common' })}
        title={t('sources.title', { ns: 'inbound' })}
        description={t('sources.description', { ns: 'inbound' })}
        actions={
          <Button
            onClick={() => {
              setDialog({ kind: 'create' });
            }}
          >
            {t('sources.create.open', { ns: 'inbound' })}
          </Button>
        }
      />
      <InboundSourcesTable
        sources={paging.pageRows}
        status={status}
        errorMessage={errorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
        onRename={(source) => {
          setDialog({ kind: 'rename', source });
        }}
        onEditConnection={(source) => {
          setDialog({ kind: 'connection', source });
        }}
        onArchive={(source) => {
          setDialog({ kind: 'archive', source });
        }}
        paging={paging}
        timeZone={timeZone}
      />
      {dialog?.kind === 'create' ? (
        <CreateInboundSourceDialog
          onClose={close}
          onCreated={(displayName) => {
            done(t('sources.create.toast', { ns: 'inbound', name: displayName }));
          }}
        />
      ) : null}
      {dialog?.kind === 'rename' ? (
        <RenameInboundSourceDialog
          source={dialog.source}
          onClose={close}
          onRenamed={(displayName) => {
            done(t('sources.rename.toast', { ns: 'inbound', name: displayName }));
          }}
        />
      ) : null}
      {dialog?.kind === 'connection' ? (
        <InboundSourceConnectionDialog
          source={dialog.source}
          onClose={close}
          onSaved={() => {
            done(t('sources.connection.toast', { ns: 'inbound', name: dialog.source.displayName }));
          }}
        />
      ) : null}
      {dialog?.kind === 'archive' ? (
        <ArchiveInboundSourceDialog
          source={dialog.source}
          onClose={close}
          onDone={() => {
            done(t('sources.archive.toast', { ns: 'inbound', name: dialog.source.displayName }));
          }}
        />
      ) : null}
    </>
  );
}
