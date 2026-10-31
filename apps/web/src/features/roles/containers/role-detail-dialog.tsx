import type { Role } from '@iam/contracts';
import { Button, Check, Dialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { groupPermissions } from '../model/permission-groups';

export type RoleDetailDialogProps = {
  role: Role;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
};

/**
 * Detalle de un rol en un panel lateral, como en el diseño de Compass: tipo, número de permisos y
 * los permisos agrupados por área. Editar y archivar solo se ofrecen en los personalizados (el
 * servidor rechaza igual los de sistema).
 */
export function RoleDetailDialog({ role, onClose, onEdit, onArchive }: RoleDetailDialogProps) {
  const { t } = useTranslation(['roles', 'common']);
  const groups = groupPermissions(role.permissions);
  return (
    <Dialog
      open
      placement="side"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={role.name}
      description={t('detail.summary', {
        ns: 'roles',
        count: role.permissions.length,
        kind: t(role.isSystem ? 'kind.system' : 'kind.custom', { ns: 'roles' }),
      })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <div className="flex flex-col gap-6">
        {groups.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('view.empty', { ns: 'roles' })}</p>
        ) : (
          groups.map((group) => (
            <section key={group.id} aria-labelledby={`detail-${role.id}-${group.id}`}>
              <h3
                id={`detail-${role.id}-${group.id}`}
                className="text-xs font-semibold uppercase text-text-muted"
              >
                {t(`permission.group.${group.id}`, { ns: 'roles' })}
              </h3>
              <ul className="mt-2 flex flex-col gap-2 text-sm text-text">
                {group.permissions.map((permission) => (
                  <li key={permission} className="flex items-center gap-2">
                    <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
                    {t(`permission.${permission}`, { ns: 'roles' })}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        {role.isSystem ? (
          <p className="border-t border-border pt-4 text-sm text-text-secondary">
            {t('detail.systemNote', { ns: 'roles' })}
          </p>
        ) : (
          <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
            <Button variant="ghost" className="text-danger" onClick={onArchive}>
              {t('archive.confirm', { ns: 'roles' })}
            </Button>
            <Button onClick={onEdit}>{t('detail.edit', { ns: 'roles' })}</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
