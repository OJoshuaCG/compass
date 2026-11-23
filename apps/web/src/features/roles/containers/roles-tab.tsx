import { Plus, buttonVariants } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { useFixedOrderTable } from '../../../shared/api';
import { useErrorMessage } from '../../../shared/i18n';
import { fetchRolesPage, rolesKeys } from '../api/roles-api';
import { RoleCards } from '../ui/role-cards';

/**
 * Pestaña "Roles" de `/roles`: los roles en tarjetas (diseño de Compass) y "Nuevo rol". Cada
 * tarjeta abre el editor del rol a página completa (`/roles/$roleId`).
 */
export function RolesTab() {
  const { t } = useTranslation(['roles', 'common']);
  const errorMessage = useErrorMessage();

  const table = useFixedOrderTable({ queryKey: rolesKeys.list(), fetchPage: fetchRolesPage });

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Link to="/roles/new" className={buttonVariants()}>
          <Plus aria-hidden="true" className="size-4" />
          {t('create.open', { ns: 'roles' })}
        </Link>
      </div>
      <RoleCards
        roles={table.rows}
        status={table.status}
        errorMessage={errorMessage(table.error)}
        onRetry={table.retry}
        refreshing={table.refreshing}
        paging={table}
      />
    </>
  );
}
