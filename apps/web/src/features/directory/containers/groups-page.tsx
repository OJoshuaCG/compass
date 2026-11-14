import type { Group } from '@iam/contracts';
import { Button, PageHeader, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { fetchGroups, groupsKeys } from '../api/groups-api';
import { GroupsTable } from '../ui/groups-table';

import { CreateGroupDialog } from './create-group-dialog';
import { GroupMembersDialog } from './group-members-dialog';

type DialogState = { kind: 'create' } | { kind: 'members'; groupId: string } | null;

/**
 * Container de `/groups`: los grupos que la persona puede ver, crear uno y gestionar miembros.
 * El botón «Crear grupo» se ofrece con el permiso `group.create` y los controles de miembros con
 * `canManageMembers` de cada grupo; es solo comodidad, el servidor decide siempre.
 */
export function GroupsPage() {
  const catalogReady = useLazyCatalog('directory');
  const { t } = useTranslation(['directory', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canCreate = usePermission('group.create');
  const [dialog, setDialog] = useState<DialogState>(null);

  const groupsQuery = useQuery({
    queryKey: groupsKeys.list(),
    queryFn: ({ signal }) => fetchGroups(signal),
    staleTime: 0,
  });

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const groups: Group[] = groupsQuery.data ?? [];
  // El diálogo de miembros se busca por identificador para que el conteo y los permisos se
  // refresquen con la lista; si el grupo desaparece de la lista el diálogo se cierra solo.
  const membersGroup =
    dialog?.kind === 'members' ? groups.find((group) => group.id === dialog.groupId) : undefined;
  const tableStatus = groupsQuery.isPending ? 'loading' : groupsQuery.isError ? 'error' : 'success';

  const createButton = canCreate ? (
    <Button
      onClick={() => {
        setDialog({ kind: 'create' });
      }}
    >
      {t('groups.action.create')}
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        eyebrow={t('nav.group.workspace', { ns: 'common' })}
        title={t('groups.title')}
        description={t('groups.description')}
        actions={createButton}
      />
      <GroupsTable
        groups={groups}
        status={tableStatus}
        errorMessage={errorMessage(groupsQuery.error)}
        onRetry={() => {
          void groupsQuery.refetch();
        }}
        onOpenMembers={(group) => {
          setDialog({ kind: 'members', groupId: group.id });
        }}
      />
      {canCreate ? (
        <CreateGroupDialog
          open={dialog?.kind === 'create'}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onCreated={(name) => {
            toast.show(t('groups.create.toast', { name }), 'success');
            setDialog(null);
            void queryClient.invalidateQueries({ queryKey: groupsKeys.list() });
          }}
        />
      ) : null}
      {membersGroup !== undefined ? (
        <GroupMembersDialog
          group={membersGroup}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
}
