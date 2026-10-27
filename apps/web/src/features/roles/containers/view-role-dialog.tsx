import type { Role } from '@iam/contracts';
import { Dialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { groupPermissions } from '../model/permission-groups';

export type ViewRoleDialogProps = {
  role: Role;
  onClose: () => void;
};

/** Lista de solo lectura de los permisos de un rol, agrupados por área. */
export function ViewRoleDialog({ role, onClose }: ViewRoleDialogProps) {
  const { t } = useTranslation(['roles', 'common']);
  const groups = groupPermissions(role.permissions);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('view.title', { ns: 'roles', name: role.name })}
      description={t('view.description', { ns: 'roles' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {groups.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('view.empty', { ns: 'roles' })}</p>
      ) : (
        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`view-${role.id}-${group.id}`}>
              <h3
                id={`view-${role.id}-${group.id}`}
                className="text-xs font-medium uppercase text-text-muted"
              >
                {t(`permission.group.${group.id}`, { ns: 'roles' })}
              </h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-text">
                {group.permissions.map((permission) => (
                  <li key={permission}>{t(`permission.${permission}`, { ns: 'roles' })}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
