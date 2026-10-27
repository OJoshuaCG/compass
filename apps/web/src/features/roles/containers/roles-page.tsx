import type { Role } from '@iam/contracts';
import { Button, PageHeader, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { fetchRoles, rolesKeys } from '../api/roles-api';
import { RolesTable } from '../ui/roles-table';

import { ArchiveRoleDialog } from './archive-role-dialog';
import { CreateRoleDialog } from './create-role-dialog';
import { ViewRoleDialog } from './view-role-dialog';

type DialogState = { kind: 'view' | 'archive'; role: Role } | { kind: 'create' } | null;

/**
 * Container de `/roles`: la `DataTable` estándar de roles, "Crear rol" y "Archivar" (con
 * confirmación, solo en los personalizados). Tras cada cambio: aviso y recarga de la lista.
 */
export function RolesPage() {
  const catalogReady = useLazyCatalog('roles');
  const { t } = useTranslation(['roles', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [dialog, setDialog] = useState<DialogState>(null);

  const query = useQuery({
    queryKey: rolesKeys.list(),
    queryFn: ({ signal }) => fetchRoles(signal),
    staleTime: 0,
  });

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'success';
  const close = () => {
    setDialog(null);
  };
  /** Los roles también alimentan el diálogo de invitar: se recarga todo lo de roles del feature. */
  const done = (message: string) => {
    toast.show(message, 'success');
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: rolesKeys.all });
  };

  return (
    <>
      <PageHeader
        title={t('title', { ns: 'roles' })}
        description={t('description', { ns: 'roles' })}
        actions={
          <Button
            onClick={() => {
              setDialog({ kind: 'create' });
            }}
          >
            {t('create.open', { ns: 'roles' })}
          </Button>
        }
      />
      <RolesTable
        roles={query.data ?? []}
        status={status}
        errorMessage={errorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
        onView={(role) => {
          setDialog({ kind: 'view', role });
        }}
        onArchive={(role) => {
          setDialog({ kind: 'archive', role });
        }}
        refreshing={query.isFetching && !query.isPending}
      />
      <CreateRoleDialog
        open={dialog?.kind === 'create'}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        available={me?.permissions ?? []}
        onCreated={(name) => {
          done(t('create.toast', { ns: 'roles', name }));
        }}
      />
      {dialog?.kind === 'view' ? <ViewRoleDialog role={dialog.role} onClose={close} /> : null}
      {dialog?.kind === 'archive' ? (
        <ArchiveRoleDialog
          role={dialog.role}
          onClose={close}
          onDone={() => {
            done(t('archive.toast', { ns: 'roles', name: dialog.role.name }));
          }}
        />
      ) : null}
    </>
  );
}
