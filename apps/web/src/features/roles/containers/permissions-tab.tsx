import { Spinner } from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { ErrorAlert } from '../../../shared/i18n';
import { fetchPermissionCatalog, rolesKeys } from '../api/roles-api';
import { groupPermissions } from '../model/permission-groups';
import { PermissionCatalog, type PermissionCatalogGroup } from '../ui/permission-catalog';

/**
 * Pestaña "Permisos": el catálogo de solo lectura con el rango más bajo que puede tener cada
 * permiso. Los textos de permisos y áreas son los mismos del selector de permisos.
 */
export function PermissionsTab() {
  const { t } = useTranslation(['roles', 'common']);
  const query = useQuery({
    queryKey: rolesKeys.permissionCatalog(),
    queryFn: ({ signal }) => fetchPermissionCatalog(signal),
  });

  if (query.isPending) return <Spinner label={t('state.loading', { ns: 'common' })} />;
  if (query.isError) {
    return (
      <ErrorAlert
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const maxRankByPermission = new Map(query.data.map((entry) => [entry.permission, entry.maxRank]));
  const groups: PermissionCatalogGroup[] = groupPermissions([...maxRankByPermission.keys()]).map(
    (group) => ({
      id: group.id,
      label: t(`permission.group.${group.id}`, { ns: 'roles' }),
      items: group.permissions.map((permission) => ({
        id: permission,
        label: t(`permission.${permission}`, { ns: 'roles' }),
        maxRankLabel: t('permissions.maxRank', {
          ns: 'roles',
          rank: t(`rank.${String(maxRankByPermission.get(permission) ?? 3)}`, { ns: 'common' }),
        }),
      })),
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">{t('permissions.help', { ns: 'roles' })}</p>
      <PermissionCatalog groups={groups} emptyMessage={t('permissions.empty', { ns: 'roles' })} />
    </div>
  );
}
