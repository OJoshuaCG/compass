import { PageHeader, Button, Spinner, Tabs, UserPlus } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TableSearch } from '../../../shared/api';
import { useMe, usePermission } from '../../../shared/auth';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { canManageTeam } from '../model/team-actions';

import { DirectoryTable } from './directory-table';
import { InviteUserDialog } from './invite-user-dialog';
import { TeamManagement } from './team-management';

/** Sección activa de la página: se guarda en la URL como el resto del estado de la vista. */
export type UsersView = 'directory' | 'team';

export type UsersSearch = TableSearch & { view?: UsersView | undefined };

export type UsersPageProps = {
  /** Estado de la tabla que vive en la URL (validado por la ruta). */
  search: UsersSearch;
  onSearchChange: (patch: Partial<UsersSearch>) => void;
};

/**
 * Container de `/users`: el directorio con la `DataTable` estándar y la acción de invitar y, para
 * quien puede gestionar personas, la pestaña "Gestión del equipo".
 */
export function UsersPage({ search, onSearchChange }: UsersPageProps) {
  const { t } = useTranslation(['directory', 'common']);
  const me = useMe();
  // Solo comodidad: el botón y la pestaña se ocultan sin el permiso, pero el backend decide siempre.
  const canInvite = usePermission('user.invite');
  const showTeam = me !== undefined && canManageTeam(me.permissions);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Los textos de esta pantalla viajan en un catálogo aparte (presupuesto de JS inicial).
  const catalogReady = useLazyCatalog('directory');

  // La vista `team` en la URL sin permiso cae al directorio en vez de mostrar un error.
  const view: UsersView = showTeam && search.view === 'team' ? 'team' : 'directory';
  const tableSearch: TableSearch = {
    limit: search.limit,
    sort: search.sort,
    dir: search.dir,
    q: search.q,
  };

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const panel =
    view === 'team' && me !== undefined ? (
      <TeamManagement
        search={tableSearch}
        onSearchChange={onSearchChange}
        actor={{ rank: me.user.rank, permissions: me.permissions }}
      />
    ) : (
      <DirectoryTable search={tableSearch} onSearchChange={onSearchChange} />
    );

  return (
    <>
      <PageHeader
        title={t('users.title', { ns: 'directory' })}
        description={t('users.description', { ns: 'directory' })}
        actions={
          canInvite ? (
            <Button
              onClick={() => {
                setInviteOpen(true);
              }}
            >
              <UserPlus aria-hidden="true" className="size-4" />
              {t('users.invite', { ns: 'directory' })}
            </Button>
          ) : undefined
        }
      />
      {showTeam ? (
        <Tabs
          label={t('users.tabs.label', { ns: 'directory' })}
          tabs={[
            { id: 'directory', label: t('users.tabs.directory', { ns: 'directory' }) },
            { id: 'team', label: t('users.tabs.team', { ns: 'directory' }) },
          ]}
          value={view}
          onValueChange={(next) => {
            // Cada sección tiene su propia búsqueda y orden: al cambiar se parte de cero
            // (el límite de filas sí se conserva).
            onSearchChange({
              view: next === 'team' ? 'team' : undefined,
              q: undefined,
              sort: undefined,
              dir: undefined,
            });
          }}
        >
          {panel}
        </Tabs>
      ) : (
        panel
      )}
      {canInvite && me !== undefined ? (
        <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} actorRank={me.user.rank} />
      ) : null}
    </>
  );
}
