import { KeyRound, ShieldCheck, Users } from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { usePermission } from '../../../shared/auth';
import {
  fetchInventoryCount,
  fetchManagedCount,
  fetchSessionsCount,
  homeKeys,
} from '../api/home-api';
import type { SummaryCount } from '../model/summary-count';
import { ShortcutLink } from '../ui/shortcut-link';
import { SummaryCard } from '../ui/summary-card';

type CountCardProps = {
  title: string;
  emptyText: string;
  queryKey: readonly unknown[];
  fetchCount: (signal: AbortSignal) => Promise<SummaryCount>;
};

/** Tarjeta conectada a su consulta. Las cifras cambian desde otros dispositivos: siempre se recargan. */
function CountCard({ title, emptyText, queryKey, fetchCount }: CountCardProps) {
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchCount(signal),
    staleTime: 0,
  });
  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'ready';
  return (
    <SummaryCard
      title={title}
      status={status}
      error={query.error}
      onRetry={() => {
        void query.refetch();
      }}
      count={query.data}
      emptyText={emptyText}
    />
  );
}

/**
 * Cifras y accesos directos del inicio. Todo es solo comodidad: la tarjeta del inventario se oculta
 * sin `vault.inventory.read`, pero el servidor decide siempre y responde 403 aunque se forzara.
 * "Personas a tu cargo" y las sesiones propias no tienen permiso propio: el servidor devuelve
 * únicamente lo que corresponde a quien consulta.
 */
export function HomeSummary() {
  const { t } = useTranslation('common');
  const canReadInventory = usePermission('vault.inventory.read');
  return (
    <>
      <section aria-labelledby="home-summary-title" className="flex flex-col gap-4">
        <h2 id="home-summary-title" className="font-heading text-lg font-semibold text-text">
          {t('home.summary.title')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CountCard
            title={t('home.team.title')}
            emptyText={t('home.team.empty')}
            queryKey={homeKeys.managedCount()}
            fetchCount={fetchManagedCount}
          />
          {canReadInventory ? (
            <CountCard
              title={t('home.inventory.title')}
              emptyText={t('home.inventory.empty')}
              queryKey={homeKeys.inventoryCount()}
              fetchCount={fetchInventoryCount}
            />
          ) : null}
          <CountCard
            title={t('home.sessions.title')}
            emptyText={t('home.sessions.empty')}
            queryKey={homeKeys.sessionsCount()}
            fetchCount={fetchSessionsCount}
          />
        </div>
      </section>
      <section aria-labelledby="home-shortcuts-title" className="flex flex-col gap-4">
        <h2 id="home-shortcuts-title" className="font-heading text-lg font-semibold text-text">
          {t('home.shortcuts.title')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ShortcutLink
            to="/users"
            icon={<Users className="size-5" />}
            title={t('nav.users')}
            description={t('home.shortcuts.users')}
          />
          <ShortcutLink
            to="/accounts"
            icon={<KeyRound className="size-5" />}
            title={t('nav.accounts')}
            description={t('home.shortcuts.accounts')}
          />
          <ShortcutLink
            to="/security"
            icon={<ShieldCheck className="size-5" />}
            title={t('nav.security')}
            description={t('home.shortcuts.security')}
          />
        </div>
      </section>
    </>
  );
}
