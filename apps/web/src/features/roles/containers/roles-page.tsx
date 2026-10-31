import type { Role } from '@iam/contracts';
import { Button, PageHeader, Spinner } from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFixedOrderTable } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { fetchRolesPage, rolesKeys } from '../api/roles-api';
import { RolesTable } from '../ui/roles-table';

import { ArchiveRoleDialog } from './archive-role-dialog';
import { CreateRoleDialog } from './create-role-dialog';
import { EditRoleDialog } from './edit-role-dialog';
import { ViewRoleDialog } from './view-role-dialog';

type DialogState = { kind: 'view' | 'edit' | 'archive'; role: Role } | { kind: 'create' } | null;

/**
 * Container de `/roles`: la `DataTable` estándar de roles, "Crear rol", "Editar" y "Archivar"
 * (este con confirmación; ambos solo en los personalizados). Tras cada cambio: aviso y recarga.
 */
export function RolesPage() {
  const catalogReady = useLazyCatalog('roles');
  const { t } = useTranslation(['roles', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [dialog, setDialog] = useState<DialogState>(null);

  const table = useFixedOrderTable({ queryKey: rolesKeys.list(), fetchPage: fetchRolesPage });

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

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
        roles={table.rows}
        status={table.status}
        errorMessage={errorMessage(table.error)}
        onRetry={table.retry}
        onView={(role) => {
          setDialog({ kind: 'view', role });
        }}
        onEdit={(role) => {
          setDialog({ kind: 'edit', role });
        }}
        onArchive={(role) => {
          setDialog({ kind: 'archive', role });
        }}
        refreshing={table.refreshing}
        paging={table}
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
      {dialog?.kind === 'edit' ? (
        <EditRoleDialog
          role={dialog.role}
          available={me?.permissions ?? []}
          onClose={close}
          onUpdated={(name) => {
            done(t('edit.toast', { ns: 'roles', name }));
          }}
        />
      ) : null}
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
