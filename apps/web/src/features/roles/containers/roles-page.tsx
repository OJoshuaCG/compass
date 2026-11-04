import { PageHeader, Spinner, Tabs } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';

import { PermissionsTab } from './permissions-tab';
import { RolesTab } from './roles-tab';

type RolesTabId = 'roles' | 'permissions';

/**
 * Container de `/roles`: encabezado y dos pestañas. "Roles" es la gestión de roles de siempre;
 * "Permisos" es el catálogo de solo lectura. El panel inactivo no se monta, así que su consulta no
 * se pide hasta que se elige la pestaña.
 */
export function RolesPage() {
  const catalogReady = useLazyCatalog('roles');
  const { t } = useTranslation(['roles', 'common']);
  const [tab, setTab] = useState<RolesTabId>('roles');

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  return (
    <>
      <PageHeader
        eyebrow={t('nav.group.access', { ns: 'common' })}
        title={t('title', { ns: 'roles' })}
        description={t('description', { ns: 'roles' })}
      />
      <Tabs
        label={t('tabs.label', { ns: 'roles' })}
        tabs={[
          { id: 'roles', label: t('tabs.roles', { ns: 'roles' }) },
          { id: 'permissions', label: t('tabs.permissions', { ns: 'roles' }) },
        ]}
        value={tab}
        onValueChange={(next) => {
          setTab(next === 'permissions' ? 'permissions' : 'roles');
        }}
      >
        {tab === 'roles' ? <RolesTab /> : <PermissionsTab />}
      </Tabs>
    </>
  );
}
