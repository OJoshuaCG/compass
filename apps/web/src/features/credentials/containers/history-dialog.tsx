import type { Credential, PasswordVersion } from '@iam/contracts';
import { Alert, Button, Dialog, EmptyState, StatusBadge, DataTable, type Column } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe, usePermission } from '../../../shared/auth';
import { useDataTableLabels, useErrorMessage } from '../../../shared/i18n';
import { formatDateTime, useClientPagination } from '../../../shared/lib';
import { credentialsKeys, fetchCredentialHistory } from '../api/credentials-api';
import { canRestoreVersion } from '../model/credential-access';
import { RestoreVersionDialog } from './restore-version-dialog';

const NO_OP = () => undefined;

export type HistoryDialogProps = {
  credential: Credential;
  onClose: () => void;
};

/**
 * Historial de versiones de la contraseña: número, vigencia y fecha, nunca el contenido. Cada
 * versión anterior ofrece "Restaurar" solo a quien tiene el permiso `credential.restore_version`
 * (el historial ya exige nivel EDIT); la vigente no lo ofrece, porque el servidor la rechazaría.
 * El servidor vuelve a decidir: ocultar el botón es comodidad, no autorización.
 */
export function HistoryDialog({ credential, onClose }: HistoryDialogProps) {
  const { t, i18n } = useTranslation(['credentials', 'common']);
  const errorMessage = useErrorMessage();
  const labels = useDataTableLabels();
  const timeZone = useMe()?.user.timezone;
  const queryClient = useQueryClient();
  const hasRestorePermission = usePermission('credential.restore_version');
  // El historial solo se abre con nivel EDIT o más, así que aquí el nivel ya está garantizado.
  const mayRestore = canRestoreVersion(hasRestorePermission, 'EDIT');
  // Solo el número de versión: la contraseña nunca llega al navegador en este flujo.
  const [versionToRestore, setVersionToRestore] = useState<number | null>(null);
  const [restoredVersion, setRestoredVersion] = useState<number | null>(null);

  // Puede cambiar desde otra pestaña o persona: siempre se recarga al abrir.
  const query = useQuery({
    queryKey: credentialsKeys.history(credential.id),
    queryFn: ({ signal }) => fetchCredentialHistory(credential.id, signal),
    staleTime: 0,
  });

  const columns = useMemo<Column<PasswordVersion>[]>(
    () => [
      {
        id: 'version',
        header: t('history.col.version', { ns: 'credentials' }),
        cell: (row) => row.version,
      },
      {
        id: 'state',
        header: t('history.col.state', { ns: 'credentials' }),
        cell: (row) =>
          row.isCurrent ? (
            <StatusBadge status="success" label={t('history.current', { ns: 'credentials' })} />
          ) : (
            <StatusBadge status="neutral" label={t('history.previous', { ns: 'credentials' })} />
          ),
      },
      {
        id: 'createdAt',
        header: t('history.col.createdAt', { ns: 'credentials' }),
        cell: (row) => formatDateTime(row.createdAt, i18n.language, timeZone),
      },
    ],
    [i18n.language, t, timeZone],
  );

  function handleRestoreDone() {
    const restored = versionToRestore;
    setVersionToRestore(null);
    setRestoredVersion(restored);
    // Restaurar crea una versión nueva: cambian el historial y la fecha de última rotación del listado.
    void queryClient.invalidateQueries({ queryKey: credentialsKeys.history(credential.id) });
    void queryClient.invalidateQueries({ queryKey: credentialsKeys.list(credential.accountId) });
  }

  // El historial llega completo y puede crecer con cada rotación: se pagina en memoria.
  const paging = useClientPagination(query.data ?? []);
  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'success';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('history.title', { ns: 'credentials', label: credential.label })}
      description={t('history.description', { ns: 'credentials' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {restoredVersion !== null ? (
        <Alert tone="success">
          {t('history.restore.done', { ns: 'credentials', version: restoredVersion })}
        </Alert>
      ) : null}
      <DataTable<PasswordVersion>
        caption={t('history.caption', { ns: 'credentials' })}
        columns={columns}
        rows={paging.pageRows}
        getRowId={(row) => String(row.version)}
        status={status}
        onSortChange={NO_OP}
        limit={paging.limit}
        onLimitChange={paging.onLimitChange}
        pagination={paging.pagination}
        labels={labels}
        rowActions={(row) =>
          row.isCurrent || !mayRestore ? null : (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('history.restore.label', { ns: 'credentials', version: row.version })}
              onClick={() => {
                setRestoredVersion(null);
                setVersionToRestore(row.version);
              }}
            >
              {t('history.restore.action', { ns: 'credentials' })}
            </Button>
          )
        }
        emptyState={
          <EmptyState
            title={t('history.empty.title', { ns: 'credentials' })}
            description={t('history.empty.description', { ns: 'credentials' })}
          />
        }
        errorState={{
          message: errorMessage(query.error),
          onRetry: () => {
            void query.refetch();
          },
        }}
      />
      {versionToRestore !== null ? (
        <RestoreVersionDialog
          credential={credential}
          version={versionToRestore}
          onClose={() => {
            setVersionToRestore(null);
          }}
          onDone={handleRestoreDone}
        />
      ) : null}
    </Dialog>
  );
}
