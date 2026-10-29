import { DEFAULT_PAGE_LIMIT, type Credential, type PasswordVersion } from '@iam/contracts';
import { Dialog, EmptyState, StatusBadge, DataTable, type Column } from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { useDataTableLabels, useErrorMessage } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';
import { credentialsKeys, fetchCredentialHistory } from '../api/credentials-api';

const NO_OP = () => undefined;

export type HistoryDialogProps = {
  credential: Credential;
  onClose: () => void;
};

/** Historial de versiones de la contraseña: número, vigencia y fecha, nunca el contenido. */
export function HistoryDialog({ credential, onClose }: HistoryDialogProps) {
  const { t, i18n } = useTranslation(['credentials', 'common']);
  const errorMessage = useErrorMessage();
  const labels = useDataTableLabels();
  const timeZone = useMe()?.user.timezone;

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
      <DataTable<PasswordVersion>
        caption={t('history.caption', { ns: 'credentials' })}
        columns={columns}
        rows={query.data ?? []}
        getRowId={(row) => String(row.version)}
        status={status}
        onSortChange={NO_OP}
        limit={DEFAULT_PAGE_LIMIT}
        onLimitChange={NO_OP}
        pagination={{ hasPrevious: false, hasNext: false, onPrevious: NO_OP, onNext: NO_OP }}
        hidePagination
        labels={labels}
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
    </Dialog>
  );
}
