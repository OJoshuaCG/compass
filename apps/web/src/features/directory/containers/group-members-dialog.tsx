import type { Group, GroupMember } from '@iam/contracts';
import { Badge, Button, ConfirmDialog, Dialog, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { useToast } from '../../../shared/toast';
import { fetchGroupMembers, groupsKeys, removeGroupMember } from '../api/groups-api';
import { PersonCell } from '../ui/person-cell';

import { AddGroupMemberForm } from './add-group-member-form';

type RemoveMemberDialogProps = {
  group: Group;
  member: GroupMember;
  onClose: () => void;
  /** Éxito: recibe la lista actualizada que devolvió el servidor. */
  onRemoved: (members: GroupMember[]) => void;
};

/** Confirmación antes de quitar a una persona (docs/frontend.md §6.2: lo destructivo confirma). */
function RemoveMemberDialog({ group, member, onClose, onRemoved }: RemoveMemberDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  const action = useAsyncAction(() => removeGroupMember(group.id, member.userId));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    // `GROUP.LAST_MANAGER` y el resto se muestran en el aviso del diálogo (`action.error`).
    if (result.ok) onRemoved(result.value);
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('groups.members.remove.title', { name: member.displayName })}
      description={t('groups.members.remove.description', { group: group.name })}
      confirmLabel={t('groups.members.remove.confirm')}
      cancelLabel={t('actions.cancel', { ns: 'common' })}
      tone="danger"
      loading={action.pending}
      confirmDisabled={cooldown.secondsLeft > 0}
      onConfirm={() => {
        void confirm();
      }}
    >
      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
    </ConfirmDialog>
  );
}

export type GroupMembersDialogProps = {
  group: Group;
  onClose: () => void;
};

/**
 * Diálogo «Miembros» de un grupo: la lista y, solo con `canManageMembers`, agregar y quitar. Es
 * comodidad de la UI; el servidor decide siempre. Cada alta o baja devuelve la lista completa, que
 * reemplaza la de la caché, y el listado de grupos se recarga para actualizar el conteo.
 */
export function GroupMembersDialog({ group, onClose }: GroupMembersDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [memberToRemove, setMemberToRemove] = useState<GroupMember | undefined>(undefined);

  // Siempre se recarga: otra persona pudo cambiar la lista desde otra sesión.
  const members = useQuery({
    queryKey: groupsKeys.members(group.id),
    queryFn: ({ signal }) => fetchGroupMembers(group.id, signal),
    staleTime: 0,
  });

  function showMembers(next: GroupMember[]) {
    queryClient.setQueryData(groupsKeys.members(group.id), next);
    void queryClient.invalidateQueries({ queryKey: groupsKeys.list() });
  }

  const list = members.data ?? [];

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={t('groups.members.title', { name: group.name })}
        description={t(
          group.canManageMembers
            ? 'groups.members.descriptionManage'
            : 'groups.members.description',
        )}
        closeLabel={t('dialog.close', { ns: 'common' })}
      >
        <div className="flex flex-col gap-6">
          {members.isPending ? <Spinner label={t('state.loading', { ns: 'common' })} /> : null}
          {members.isError ? (
            <ErrorAlert
              error={members.error}
              onRetry={() => {
                void members.refetch();
              }}
            />
          ) : null}
          {members.isSuccess && list.length === 0 ? (
            <p className="text-sm text-text-secondary">{t('groups.members.empty')}</p>
          ) : null}
          {list.length > 0 ? (
            <ul
              aria-label={t('groups.members.listLabel')}
              className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto"
            >
              {list.map((member) => (
                <li key={member.userId} className="flex items-center justify-between gap-3 py-2">
                  <PersonCell displayName={member.displayName} />
                  <span className="flex items-center gap-2">
                    <Badge dot tone={member.role === 'manager' ? 'accent' : 'neutral'}>
                      {t(`groups.role.${member.role}`)}
                    </Badge>
                    {group.canManageMembers ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={t('groups.members.remove.label', { name: member.displayName })}
                        onClick={() => {
                          setMemberToRemove(member);
                        }}
                      >
                        {t('groups.members.remove.action')}
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {group.canManageMembers && members.isSuccess ? (
            <AddGroupMemberForm
              groupId={group.id}
              members={list}
              onAdded={(next, personName) => {
                showMembers(next);
                toast.show(t('groups.members.add.toast', { name: personName }), 'success');
              }}
            />
          ) : null}
        </div>
      </Dialog>
      {memberToRemove !== undefined ? (
        <RemoveMemberDialog
          group={group}
          member={memberToRemove}
          onClose={() => {
            setMemberToRemove(undefined);
          }}
          onRemoved={(next) => {
            const removedName = memberToRemove.displayName;
            setMemberToRemove(undefined);
            showMembers(next);
            toast.show(t('groups.members.remove.toast', { name: removedName }), 'success');
          }}
        />
      ) : null}
    </>
  );
}
