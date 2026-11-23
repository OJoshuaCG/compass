import { Archive, ChevronRight, Panel, Settings, Users, cn, type LucideIcon } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type AccountOptionsPanelProps = {
  accountId: string;
  /** Cada opción solo aparece si el container la permite (permiso + nivel); el servidor decide igual. */
  canManageShares: boolean;
  canEdit: boolean;
  canArchive: boolean;
  onEdit: () => void;
  onArchive: () => void;
};

const itemClass =
  'flex w-full items-center gap-3 px-5 py-3 text-start transition-colors duration-fast hover:bg-raised';

function OptionContent({
  icon: Icon,
  title,
  hint,
  danger = false,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  danger?: boolean;
}): ReactNode {
  return (
    <>
      <Icon
        aria-hidden="true"
        className={cn('size-5 shrink-0', danger ? 'text-danger' : 'text-text-muted')}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('text-sm font-semibold', danger ? 'text-danger' : 'text-text')}>
          {title}
        </span>
        <span className="text-xs text-text-muted">{hint}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
    </>
  );
}

/**
 * "Opciones" del detalle de cuenta (diseño de Compass): gestionar accesos, editar y archivar, cada
 * una solo si se permite. Sin ninguna, el panel no se pinta.
 */
export function AccountOptionsPanel({
  accountId,
  canManageShares,
  canEdit,
  canArchive,
  onEdit,
  onArchive,
}: AccountOptionsPanelProps) {
  const { t } = useTranslation('credentials');
  if (!canManageShares && !canEdit && !canArchive) return null;
  return (
    <Panel title={t('options.title')}>
      <ul className="flex flex-col divide-y divide-border">
        {canManageShares ? (
          <li>
            <Link to="/accounts/$accountId/shares" params={{ accountId }} className={itemClass}>
              <OptionContent
                icon={Users}
                title={t('options.shares')}
                hint={t('options.sharesHint')}
              />
            </Link>
          </li>
        ) : null}
        {canEdit ? (
          <li>
            <button type="button" className={itemClass} onClick={onEdit}>
              <OptionContent
                icon={Settings}
                title={t('options.edit')}
                hint={t('options.editHint')}
              />
            </button>
          </li>
        ) : null}
        {canArchive ? (
          <li>
            <button type="button" className={itemClass} onClick={onArchive}>
              <OptionContent
                icon={Archive}
                title={t('options.archive')}
                hint={t('options.archiveHint')}
                danger
              />
            </button>
          </li>
        ) : null}
      </ul>
    </Panel>
  );
}
