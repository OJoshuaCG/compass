import { DEFAULT_PAGE_LIMIT, type Credential } from '@iam/contracts';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  RowActionsMenu,
  type Column,
  type RowActionItem,
} from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';

export type CredentialsTableProps = {
  credentials: Credential[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  /** Zona horaria del perfil, para las fechas. */
  timeZone: string | undefined;
  /** Decisiones de comodidad (permiso + nivel) que toma el container; el servidor decide siempre. */
  canCopyUsername: boolean;
  canReveal: boolean;
  canChangePassword: boolean;
  canViewHistory: boolean;
  /** Abrir el diálogo del segundo factor: permiso `credential.use_totp` y nivel USE. */
  canOpenTotp: boolean;
  onCopyUsername: (credential: Credential) => void;
  onReveal: (credential: Credential) => void;
  onChangePassword: (credential: Credential) => void;
  onViewHistory: (credential: Credential) => void;
  onOpenTotp: (credential: Credential) => void;
};

const NO_OP = () => undefined;

/**
 * Selector del disparador del menú "⋯" de una fila. El container lo usa para devolver el foco a un
 * elemento que siga montado cuando se cierra un diálogo abierto desde ese menú.
 */
export function rowMenuTriggerSelector(credentialId: string): string {
  return `[data-credential-row-menu="${credentialId}"] button`;
}

/**
 * Tabla estándar de credenciales. Presentacional: nunca recibe usuario ni contraseña, solo los
 * metadatos del listado. Las acciones aparecen según lo que el container dice que la cuenta admite.
 * El listado llega completo (sin cursor), así que se omite el pie de paginación.
 */
export function CredentialsTable({
  credentials,
  status,
  errorMessage,
  onRetry,
  timeZone,
  canCopyUsername,
  canReveal,
  canChangePassword,
  canViewHistory,
  canOpenTotp,
  onCopyUsername,
  onReveal,
  onChangePassword,
  onViewHistory,
  onOpenTotp,
}: CredentialsTableProps) {
  const { t, i18n } = useTranslation('credentials');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<Credential>[]>(
    () => [
      { id: 'label', header: t('col.label'), cell: (row) => row.label },
      { id: 'kind', header: t('col.kind'), cell: (row) => <Badge>{t(`kind.${row.kind}`)}</Badge> },
      {
        id: 'lastRotated',
        header: t('col.lastRotated'),
        cell: (row) =>
          row.lastRotatedAt === null
            ? t('rotated.never')
            : formatDateTime(row.lastRotatedAt, i18n.language, timeZone),
      },
    ],
    [i18n.language, t, timeZone],
  );

  // Las demás acciones viven en el menú "⋯" (docs/frontend.md §6.2). Cada una solo se ofrece si el
  // container la permite; sin ninguna el menú no se pinta. Los textos visibles son los nombres
  // accesibles; el botón del menú nombra a la credencial.
  function menuItemsFor(row: Credential): RowActionItem[] {
    const items: RowActionItem[] = [];
    if (canCopyUsername) {
      items.push({
        id: 'copyUsername',
        label: t('action.copyUsername'),
        onSelect: () => {
          onCopyUsername(row);
        },
      });
    }
    if (canChangePassword) {
      items.push({
        id: 'changePassword',
        label: t('action.changePassword'),
        onSelect: () => {
          onChangePassword(row);
        },
      });
    }
    if (canViewHistory) {
      items.push({
        id: 'history',
        label: t('action.history'),
        onSelect: () => {
          onViewHistory(row);
        },
      });
    }
    if (canOpenTotp) {
      items.push({
        id: 'totp',
        label: t('action.totp'),
        onSelect: () => {
          onOpenTotp(row);
        },
      });
    }
    return items;
  }

  const hasAnyAction =
    canCopyUsername || canReveal || canChangePassword || canViewHistory || canOpenTotp;

  return (
    <DataTable<Credential>
      caption={t('caption')}
      columns={columns}
      rows={credentials}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={NO_OP}
      limit={DEFAULT_PAGE_LIMIT}
      onLimitChange={NO_OP}
      pagination={{ hasPrevious: false, hasNext: false, onPrevious: NO_OP, onNext: NO_OP }}
      hidePagination
      labels={labels}
      emptyState={<EmptyState title={t('empty.title')} description={t('empty.description')} />}
      errorState={{ message: errorMessage, onRetry }}
      rowActions={
        hasAnyAction
          ? (row) => (
              <span className="flex items-center justify-end gap-2">
                {canReveal ? (
                  // Acción primaria: su nombre accesible empieza con el texto visible (WCAG 2.5.3).
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('action.revealLabel', { label: row.label })}
                    onClick={() => {
                      onReveal(row);
                    }}
                  >
                    {t('action.reveal')}
                  </Button>
                ) : null}
                {/* El contenedor marca la fila para que el container devuelva el foco al disparador
                    del menú al cerrar un diálogo abierto desde él. */}
                <span data-credential-row-menu={row.id}>
                  <RowActionsMenu
                    label={t('action.rowMenu', { label: row.label })}
                    items={menuItemsFor(row)}
                  />
                </span>
              </span>
            )
          : undefined
      }
    />
  );
}
