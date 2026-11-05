import type { Rank, UserStatus } from '@iam/contracts';
import { EmptyState, Panel, Spinner } from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorAlert } from '../../../shared/i18n';
import { directoryKeys } from '../api/directory-api';
import { fetchAllManaged } from '../api/team-api';
import { buildHierarchy, type HierarchyNode } from '../model/build-hierarchy';
import { HierarchyTree } from '../ui/hierarchy-tree';

export type HierarchyPanelProps = {
  /** Quien consulta: es la raíz implícita del árbol, porque `/users/managed` no lo incluye. */
  actor: { id: string; displayName: string; rank: Rank };
};

/**
 * Árbol de responsabilidad de quien consulta. Se arma en el cliente con `/users/managed`; solo
 * organiza lo que el servidor ya autorizó y no ofrece acciones (esas viven en «Gestión del equipo»).
 */
export function HierarchyPanel({ actor }: HierarchyPanelProps) {
  const { t } = useTranslation(['directory', 'common']);
  const managedQuery = useQuery({
    queryKey: directoryKeys.hierarchy(),
    queryFn: ({ signal }) => fetchAllManaged(signal),
    // Un traspaso o una baja pueden cambiar el árbol en cualquier momento.
    staleTime: 0,
  });

  const hierarchy = useMemo(
    () => buildHierarchy(managedQuery.data ?? [], actor.id),
    [managedQuery.data, actor.id],
  );

  const rankLabel = (rank: Rank) => t(`rank.${String(rank)}`, { ns: 'common' });
  const statusLabel = (status: UserStatus) => t(`team.status.${status}`, { ns: 'directory' });

  if (managedQuery.isPending) return <Spinner label={t('state.loading', { ns: 'common' })} />;
  if (managedQuery.isError) {
    return <ErrorAlert error={managedQuery.error} secondsLeft={0} />;
  }

  const actorNode: HierarchyNode = {
    person: {
      id: actor.id,
      displayName: `${actor.displayName} (${t('hierarchy.you', { ns: 'directory' })})`,
      email: '',
      rank: actor.rank,
      status: 'active',
      managedBy: null,
      managerName: null,
      roleNames: null,
    },
    children: hierarchy.directReports,
  };

  return (
    <div className="space-y-6" aria-label={t('hierarchy.label', { ns: 'directory' })} role="region">
      {hierarchy.directReports.length === 0 && hierarchy.detached.length === 0 ? (
        <EmptyState
          title={t('hierarchy.empty.title', { ns: 'directory' })}
          description={t('hierarchy.empty.description', { ns: 'directory' })}
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
          <HierarchyTree nodes={[actorNode]} rankLabel={rankLabel} statusLabel={statusLabel} />
        </div>
      )}
      {hierarchy.detached.length > 0 ? (
        <Panel title={t('hierarchy.detached.title', { ns: 'directory' })}>
          <div className="flex flex-col gap-3 p-5">
            <p className="text-sm text-text-secondary">
              {t('hierarchy.detached.description', { ns: 'directory' })}
            </p>
            <HierarchyTree
              nodes={hierarchy.detached}
              rankLabel={rankLabel}
              statusLabel={statusLabel}
            />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
