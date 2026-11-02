import type { Role } from '@iam/contracts';
import { Button, Plus } from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFixedOrderTable } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useToast } from '../../../shared/toast';
import { fetchRolesPage, rolesKeys } from '../api/roles-api';
import { RoleCards } from '../ui/role-cards';

import { ArchiveRoleDialog } from './archive-role-dialog';
import { CreateRoleDialog } from './create-role-dialog';
import { EditRoleDialog } from './edit-role-dialog';
import { RoleDetailDialog } from './role-detail-dialog';

type DialogState = { kind: 'view' | 'edit' | 'archive'; role: Role } | { kind: 'create' } | null;

/**
 * Pestaña "Roles" de `/roles`: los roles en tarjetas (diseño de Compass) y "Crear rol". Cada tarjeta
 * abre el detalle, desde donde se edita o se archiva (este con confirmación; ambos solo en los
 * personalizados). Tras cada cambio: aviso y recarga.
 */
export function RolesTab() {
  const { t } = useTranslation(['roles', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [dialog, setDialog] = useState<DialogState>(null);

  const table = useFixedOrderTable({ queryKey: rolesKeys.list(), fetchPage: fetchRolesPage });

  const close = () => {
    setDialog(null);
  };
  /** Los roles también alimentan el diálogo de invitar: se recarga todo lo de roles del feature. */
  const done = (message: string) => {
    toast.show(message, 'success');
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: rolesKeys.all });
    // TODO(directory-facade, dueño de la fachada): también debería invalidarse `directoryKeys.all`
    // (el diálogo de roles de una persona lee roles asignables), pero `features/directory/index.ts`
    // no exporta `directoryKeys` y entre features solo se importa por la fachada. Hay que exportarlo
    // ahí; además `directory` ya importa la fachada de `roles`, así que habría un ciclo de módulos.
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setDialog({ kind: 'create' });
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t('create.open', { ns: 'roles' })}
        </Button>
      </div>
      <RoleCards
        roles={table.rows}
        status={table.status}
        errorMessage={errorMessage(table.error)}
        onRetry={table.retry}
        onOpen={(role) => {
          setDialog({ kind: 'view', role });
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
      {dialog?.kind === 'view' ? (
        <RoleDetailDialog
          role={dialog.role}
          onClose={close}
          onEdit={() => {
            setDialog({ kind: 'edit', role: dialog.role });
          }}
          onArchive={() => {
            setDialog({ kind: 'archive', role: dialog.role });
          }}
        />
      ) : null}
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
