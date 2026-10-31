import type { Role } from '@iam/contracts';
import { Button, EmptyState, IconBubble, Pagination, ShieldCheck, Skeleton, Users } from '@iam/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { TablePaging } from '../../../shared/api';
import { useDataTableLabels } from '../../../shared/i18n';
import { groupPermissions } from '../model/permission-groups';

export type RoleCardsProps = {
  roles: Role[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onOpen: (role: Role) => void;
  /** Hay una recarga en curso conservando las tarjetas anteriores. */
  refreshing: boolean;
  /** Tamaño y navegación de página que entrega el container. */
  paging: TablePaging;
};

/** Tarjetas de relleno mientras llega la primera página: mismo alto que las reales. */
const PLACEHOLDERS = 3;

/**
 * Roles en tarjetas, como en el diseño de Compass: ícono, nombre, tipo, áreas que cubre y número de
 * permisos. Cada tarjeta es un botón que abre el detalle. Presentacional: la paginación por cursor
 * y los textos de rango son los mismos de la tabla estándar.
 */
export function RoleCards({
  roles,
  status,
  errorMessage,
  onRetry,
  onOpen,
  refreshing,
  paging,
}: RoleCardsProps) {
  const { t } = useTranslation(['roles', 'common']);
  const labels = useDataTableLabels();

  const offset = paging.pagination.offset;
  const hasRoles = status === 'success' && roles.length > 0;
  const range = hasRoles ? labels.range({ from: offset + 1, to: offset + roles.length }) : '';

  return (
    <div className="flex flex-col gap-4">
      {status === 'loading' ? (
        <ul aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: PLACEHOLDERS }, (_, index) => (
            <li
              key={index}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
            >
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="w-1/2" />
              <Skeleton className="w-3/4" />
            </li>
          ))}
        </ul>
      ) : null}

      {status === 'error' ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-4 py-10 text-center"
        >
          <p className="text-sm text-danger">{errorMessage}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {labels.retry}
          </Button>
        </div>
      ) : null}

      {status === 'success' && roles.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            title={t('empty.title', { ns: 'roles' })}
            description={t('empty.description', { ns: 'roles' })}
          />
        </div>
      ) : null}

      {hasRoles ? (
        <ul
          aria-label={t('caption', { ns: 'roles' })}
          aria-busy={refreshing}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {roles.map((role) => (
            <li key={role.id} className="flex">
              <RoleCard
                role={role}
                onOpen={() => {
                  onOpen(role);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <Pagination
        labels={labels.pagination}
        rangeText={range}
        limit={paging.limit}
        onLimitChange={paging.onLimitChange}
        hasPrevious={paging.pagination.hasPrevious && status !== 'loading'}
        hasNext={paging.pagination.hasNext && status !== 'loading' && !refreshing}
        onPrevious={paging.pagination.onPrevious}
        onNext={paging.pagination.onNext}
      />
      {/* Anuncia cambios de página y de carga sin mover el foco, como la tabla estándar. */}
      <div role="status" aria-live="polite" className="sr-only">
        {status === 'loading' ? labels.loading : range}
      </div>
    </div>
  );
}

function RoleCard({ role, onOpen }: { role: Role; onOpen: () => void }) {
  const { t } = useTranslation('roles');
  const detailsId = useId();
  const groups = groupPermissions(role.permissions);
  const areas =
    groups.length === 0
      ? t('view.empty')
      : groups.map((group) => t(`permission.group.${group.id}`)).join(' · ');
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={t('card.openLabel', { name: role.name })}
      aria-describedby={detailsId}
      onClick={onOpen}
      className="flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-5 text-start shadow-card transition-colors duration-fast hover:border-accent"
    >
      <span className="flex w-full items-center gap-3">
        <IconBubble
          tone={role.isSystem ? 'success' : 'accent'}
          icon={role.isSystem ? <ShieldCheck className="size-5" /> : <Users className="size-5" />}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-bold text-text">{role.name}</span>
          <span className="text-xs text-text-muted">
            {t(role.isSystem ? 'kind.system' : 'kind.custom')}
          </span>
        </span>
      </span>
      {/* Tipo, áreas y conteos se leen como descripción del botón; el nombre ya está en la etiqueta. */}
      <span id={detailsId} className="sr-only">
        {[
          t(role.isSystem ? 'kind.system' : 'kind.custom'),
          areas,
          `${String(role.permissions.length)} ${t('card.permissions', { count: role.permissions.length })}`,
        ].join('. ')}
      </span>
      <span className="text-sm text-text-secondary">{areas}</span>
      <span className="mt-auto flex w-full gap-4 border-t border-border pt-3 text-xs text-text-muted">
        <span>
          <strong className="text-text tabular-nums">{role.permissions.length}</strong>{' '}
          {t('card.permissions', { count: role.permissions.length })}
        </span>
        <span>
          <strong className="text-text tabular-nums">{groups.length}</strong>{' '}
          {t('card.areas', { count: groups.length })}
        </span>
      </span>
    </button>
  );
}
