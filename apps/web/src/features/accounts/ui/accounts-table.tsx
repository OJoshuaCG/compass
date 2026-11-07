import type { Account, AccountListItem, Platform } from '@iam/contracts';
import {
  Archive,
  Badge,
  buttonVariants,
  cn,
  DataTable,
  EmptyState,
  IconButton,
  KeyRound,
  PlatformTile,
  RowActionsMenu,
  Share2,
  SquarePen,
  StatusBadge,
  type Column,
} from '@iam/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { TablePaging } from '../../../shared/api';
import { useDataTableLabels } from '../../../shared/i18n';
import { DESKTOP_MEDIA_QUERY, useMediaQuery } from '../../../shared/lib';

import { PasswordAgeIndicator } from './password-age-indicator';

/** Enlace con el mismo aspecto que `IconButton` pequeño (`size-8`, sin relleno). */
const iconLinkClass = cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'size-8 p-0');

/** Etiquetas visibles por fila: más alargarían la tabla; el resto se resume en «+N». */
const VISIBLE_TAGS = 3;

/** Etiquetas de una cuenta como fichas; las que no caben se nombran para lectores de pantalla. */
function AccountTags({ tags }: { tags: readonly string[] }) {
  const { t } = useTranslation('accounts');
  const hidden = tags.slice(VISIBLE_TAGS);
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {tags.slice(0, VISIBLE_TAGS).map((tag) => (
        <li key={tag}>
          <Badge>{tag}</Badge>
        </li>
      ))}
      {hidden.length > 0 ? (
        <li>
          {/* «+N» es solo visual; el lector de pantalla oye cuáles son las etiquetas ocultas. */}
          <Badge title={hidden.join(', ')}>
            <span aria-hidden="true">{t('tags.more', { count: hidden.length })}</span>
            <span className="sr-only">
              {t('tags.moreLabel', { count: hidden.length, tags: hidden.join(', ') })}
            </span>
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}

export type AccountsTableProps = {
  /**
   * `mine`: cuentas con acceso (muestra el nivel propio y las acciones). `inventory`: solo
   * metadatos; el nivel siempre llega en `null`, así que ni se pinta ni se ofrecen acciones.
   */
  variant: 'mine' | 'inventory';
  accounts: AccountListItem[];
  platforms: readonly Platform[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  /** Decisiones de comodidad que toma el container (permiso + nivel); el servidor decide siempre. */
  canEdit: (account: Account) => boolean;
  canArchive: (account: Account) => boolean;
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
  /** Hay una recarga en curso conservando las filas anteriores. */
  refreshing: boolean;
  paging: TablePaging;
  /** Búsqueda y filtros; la tabla solo los ubica en su barra superior. */
  toolbar?: ReactNode;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  /** Zona horaria del perfil para la fecha exacta del último cambio. */
  timeZone?: string | undefined;
};

/**
 * Tabla estándar de cuentas. Presentacional: el nivel propio se escribe con texto (nunca solo
 * color) y las acciones aparecen solo cuando el container dice que la fila las admite.
 */
export function AccountsTable({
  variant,
  accounts,
  platforms,
  status,
  errorMessage,
  onRetry,
  canEdit,
  canArchive,
  onEdit,
  onArchive,
  refreshing,
  paging,
  toolbar,
  hasActiveFilters = false,
  onClearFilters,
  timeZone,
}: AccountsTableProps) {
  const { t } = useTranslation('accounts');
  const labels = useDataTableLabels();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);

  const platformsById = useMemo(
    () => new Map(platforms.map((platform) => [platform.id, platform])),
    [platforms],
  );

  const columns = useMemo<Column<AccountListItem>[]>(() => {
    const nameColumn: Column<AccountListItem> = {
      id: 'name',
      header: t('col.name'),
      // Como el diseño de Compass: mosaico de la plataforma, nombre y, debajo, el identificador. En
      // "Mis cuentas" el nombre abre el detalle (el inventario no da acceso, así que no enlaza).
      cell: (row) => {
        const platform = platformsById.get(row.platformId);
        return (
          <span className="flex items-center gap-3">
            <PlatformTile
              slug={platform?.isGlobal === true ? platform.slug : undefined}
              fallback={platform?.name ?? row.displayName}
            />
            <span className="flex min-w-0 flex-col">
              {variant === 'mine' ? (
                <Link
                  to="/accounts/$accountId/credentials"
                  params={{ accountId: row.id }}
                  className="font-semibold text-text hover:text-accent hover:underline"
                >
                  {row.displayName}
                </Link>
              ) : (
                <span className="font-semibold text-text">{row.displayName}</span>
              )}
              {row.handle !== null ? (
                <span className="truncate text-xs text-text-muted">{row.handle}</span>
              ) : null}
              {row.tags.length > 0 ? <AccountTags tags={row.tags} /> : null}
            </span>
          </span>
        );
      },
    };
    const platformColumn: Column<AccountListItem> = {
      id: 'platform',
      header: t('col.platform'),
      cell: (row) => platformsById.get(row.platformId)?.name ?? t('platform.unknown'),
    };
    const levelColumn: Column<AccountListItem> = {
      id: 'level',
      header: t('col.level'),
      cell: (row) =>
        row.myLevel === null ? t('level.none') : <Badge>{t(`level.${row.myLevel}`)}</Badge>,
    };
    const lastChangedColumn: Column<AccountListItem> = {
      id: 'lastChanged',
      header: t('col.lastChanged'),
      cell: (row) => (
        <PasswordAgeIndicator
          age={row.passwordAge}
          lastChangedAt={row.lastChangedAt}
          timeZone={timeZone}
        />
      ),
    };
    const statusColumn: Column<AccountListItem> = {
      id: 'status',
      header: t('col.status'),
      cell: (row) =>
        row.status === 'active' ? (
          <StatusBadge status="success" label={t('status.active')} />
        ) : (
          <StatusBadge status="neutral" label={t('status.archived')} />
        ),
    };
    return variant === 'mine'
      ? [nameColumn, platformColumn, levelColumn, lastChangedColumn, statusColumn]
      : [nameColumn, platformColumn, lastChangedColumn, statusColumn];
  }, [platformsById, t, timeZone, variant]);

  const emptyTitle = variant === 'mine' ? t('empty.title') : t('inventory.empty.title');
  const emptyDescription =
    variant === 'mine' ? t('empty.description') : t('inventory.empty.description');

  return (
    <DataTable<AccountListItem>
      caption={variant === 'mine' ? t('caption') : t('inventory.caption')}
      columns={columns}
      rows={accounts}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={() => undefined}
      limit={paging.limit}
      onLimitChange={paging.onLimitChange}
      pagination={paging.pagination}
      refreshing={refreshing}
      hasActiveFilters={hasActiveFilters}
      {...(onClearFilters === undefined ? {} : { onClearFilters })}
      {...(toolbar === undefined ? {} : { toolbar })}
      labels={labels}
      emptyState={<EmptyState title={emptyTitle} description={emptyDescription} />}
      errorState={{ message: errorMessage, onRetry }}
      rowActions={
        variant === 'mine'
          ? (row) => {
              const name = row.displayName;
              // Escritorio: botones de solo ícono con su nombre al pasar el cursor. Móvil: un menú
              // «⋯» para que la fila no se desborde. Se pinta uno u otro, nunca ambos, para no
              // duplicar los nombres accesibles. Todas las filas de «Mis cuentas» tienen al menos
              // USE; compartir no se oculta: el servidor decide y la pantalla explica la negativa.
              if (!isDesktop) {
                return (
                  <RowActionsMenu
                    label={t('action.menuLabel', { name })}
                    items={[
                      {
                        id: 'credentials',
                        label: t('action.credentials'),
                        icon: <KeyRound className="size-4" />,
                        onSelect: () => {
                          void navigate({
                            to: '/accounts/$accountId/credentials',
                            params: { accountId: row.id },
                          });
                        },
                      },
                      {
                        id: 'share',
                        label: t('action.share'),
                        icon: <Share2 className="size-4" />,
                        onSelect: () => {
                          void navigate({
                            to: '/accounts/$accountId/shares',
                            params: { accountId: row.id },
                          });
                        },
                      },
                      ...(canEdit(row)
                        ? [
                            {
                              id: 'edit',
                              label: t('action.edit'),
                              icon: <SquarePen className="size-4" />,
                              onSelect: () => {
                                onEdit(row);
                              },
                            },
                          ]
                        : []),
                      ...(canArchive(row)
                        ? [
                            {
                              id: 'archive',
                              label: t('action.archive'),
                              tone: 'danger' as const,
                              icon: <Archive className="size-4" />,
                              onSelect: () => {
                                onArchive(row);
                              },
                            },
                          ]
                        : []),
                    ]}
                  />
                );
              }
              return (
                <span className="flex justify-end gap-1.5">
                  {/* Navegación, no acción: enlaces con aspecto de botón de ícono. */}
                  <Link
                    to="/accounts/$accountId/credentials"
                    params={{ accountId: row.id }}
                    className={iconLinkClass}
                    aria-label={t('action.credentialsLabel', { name })}
                    title={t('action.credentials')}
                  >
                    <KeyRound aria-hidden="true" className="size-4" />
                  </Link>
                  <Link
                    to="/accounts/$accountId/shares"
                    params={{ accountId: row.id }}
                    className={iconLinkClass}
                    aria-label={t('action.shareLabel', { name })}
                    title={t('action.share')}
                  >
                    <Share2 aria-hidden="true" className="size-4" />
                  </Link>
                  {canEdit(row) ? (
                    <IconButton
                      variant="secondary"
                      size="sm"
                      label={t('action.editLabel', { name })}
                      title={t('action.edit')}
                      icon={<SquarePen className="size-4" />}
                      onClick={() => {
                        onEdit(row);
                      }}
                    />
                  ) : null}
                  {canArchive(row) ? (
                    <IconButton
                      variant="secondary"
                      size="sm"
                      label={t('action.archiveLabel', { name })}
                      title={t('action.archive')}
                      icon={<Archive className="size-4" />}
                      onClick={() => {
                        onArchive(row);
                      }}
                    />
                  ) : null}
                </span>
              );
            }
          : undefined
      }
    />
  );
}
