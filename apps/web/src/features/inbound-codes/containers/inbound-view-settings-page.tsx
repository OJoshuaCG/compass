import type { InboundConfigurableView } from '@iam/contracts';
import { Button, PageHeader, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useClientPagination } from '../../../shared/lib';
import { useToast } from '../../../shared/toast';
import {
  fetchInboundConfigurableViews,
  fetchInboundSources,
  fetchInboundTemplates,
  inboundKeys,
} from '../api/inbound-api';
import { canCreateViewOnSource } from '../model/inbound-view-model';
import { InboundViewSettingsTable } from '../ui/inbound-view-settings-table';

import { ArchiveInboundViewDialog } from './archive-inbound-view-dialog';
import { CreateInboundViewDialog } from './create-inbound-view-dialog';
import { EditInboundViewDialog } from './edit-inbound-view-dialog';

type DialogState =
  { kind: 'edit' | 'archive'; view: InboundConfigurableView } | { kind: 'create' } | null;

const EMPTY_LIST: never[] = [];

/**
 * Container de `/inbound/view-settings`: las vistas que la persona puede administrar, con la
 * `DataTable` estándar. Crear, editar y archivar se ofrecen según el nivel de cada fila o fuente;
 * el servidor decide siempre. Tras cada cambio se recargan las vistas configurables, las
 * legibles y las fuentes.
 */
export function InboundViewSettingsPage() {
  const catalogReady = useLazyCatalog('inbound');
  const { t } = useTranslation(['inbound', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  const [dialog, setDialog] = useState<DialogState>(null);

  // El nivel puede cambiar desde otra pestaña o persona: siempre se recarga al volver.
  const viewsQuery = useQuery({
    queryKey: inboundKeys.configurableViews(),
    queryFn: ({ signal }) => fetchInboundConfigurableViews(signal),
    staleTime: 0,
  });
  const sourcesQuery = useQuery({
    queryKey: inboundKeys.sources(),
    queryFn: ({ signal }) => fetchInboundSources(signal),
    staleTime: 0,
  });
  const templatesQuery = useQuery({
    queryKey: inboundKeys.templates(),
    queryFn: ({ signal }) => fetchInboundTemplates(signal),
    staleTime: 0,
  });

  const sources = sourcesQuery.data ?? EMPTY_LIST;
  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.id, source.displayName])),
    [sources],
  );
  const eligibleSources = useMemo(() => sources.filter(canCreateViewOnSource), [sources]);
  const templates = templatesQuery.data ?? EMPTY_LIST;

  const paging = useClientPagination(viewsQuery.data ?? []);
  const status = viewsQuery.isPending ? 'loading' : viewsQuery.isError ? 'error' : 'success';

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const sourcesLoaded = sourcesQuery.isSuccess;
  const noEligibleSources = sourcesLoaded && eligibleSources.length === 0;
  // Sin fuentes elegibles o sin plantillas cargadas no hay nada que crear; se explica con texto.
  const canOpenCreate = sourcesLoaded && !noEligibleSources && templatesQuery.isSuccess;

  const close = () => {
    setDialog(null);
  };
  const done = (message: string) => {
    toast.show(message, 'success');
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: inboundKeys.configurableViews() });
    void queryClient.invalidateQueries({ queryKey: inboundKeys.views() });
    void queryClient.invalidateQueries({ queryKey: inboundKeys.sources() });
  };

  return (
    <>
      <PageHeader
        title={t('viewSettings.title', { ns: 'inbound' })}
        description={t('viewSettings.description', { ns: 'inbound' })}
        actions={
          <Button
            disabled={!canOpenCreate}
            onClick={() => {
              setDialog({ kind: 'create' });
            }}
          >
            {t('viewSettings.create.open', { ns: 'inbound' })}
          </Button>
        }
      />
      {noEligibleSources ? (
        <p className="mb-4 text-sm text-text-secondary">
          {t('viewSettings.create.noSources', { ns: 'inbound' })}
        </p>
      ) : null}
      <InboundViewSettingsTable
        views={paging.pageRows}
        sourceNames={sourceNames}
        status={status}
        errorMessage={errorMessage(viewsQuery.error)}
        onRetry={() => {
          void viewsQuery.refetch();
        }}
        onEdit={(view) => {
          setDialog({ kind: 'edit', view });
        }}
        onArchive={(view) => {
          setDialog({ kind: 'archive', view });
        }}
        paging={paging}
        timeZone={timeZone}
      />
      {dialog?.kind === 'create' ? (
        <CreateInboundViewDialog
          sources={eligibleSources}
          templates={templates}
          onClose={close}
          onCreated={(name) => {
            done(t('viewSettings.create.toast', { ns: 'inbound', name }));
          }}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <EditInboundViewDialog
          view={dialog.view}
          templates={templates}
          onClose={close}
          onSaved={(name) => {
            done(t('viewSettings.edit.toast', { ns: 'inbound', name }));
          }}
        />
      ) : null}
      {dialog?.kind === 'archive' ? (
        <ArchiveInboundViewDialog
          view={dialog.view}
          onClose={close}
          onDone={() => {
            done(t('viewSettings.archive.toast', { ns: 'inbound', name: dialog.view.name }));
          }}
        />
      ) : null}
    </>
  );
}
