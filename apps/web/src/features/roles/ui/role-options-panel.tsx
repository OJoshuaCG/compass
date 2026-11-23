import { Archive, ChevronRight, Copy, Panel, cn, type LucideIcon } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type RoleOptionsPanelProps = {
  roleId: string;
  /** Solo los roles personalizados se archivan; el servidor rechaza igual los de sistema. */
  canArchive: boolean;
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
 * "Opciones" del editor de un rol personalizado (diseño de Compass): duplicarlo (abre "Nuevo rol"
 * con sus permisos) y archivarlo. "Ver en auditoría" espera a la lectura real de auditoría (R1).
 */
export function RoleOptionsPanel({ roleId, canArchive, onArchive }: RoleOptionsPanelProps) {
  const { t } = useTranslation('roles');
  return (
    <Panel title={t('options.title')}>
      <ul className="flex flex-col divide-y divide-border">
        <li>
          <Link to="/roles/new" search={{ from: roleId }} className={itemClass}>
            <OptionContent
              icon={Copy}
              title={t('options.duplicate')}
              hint={t('options.duplicateHint')}
            />
          </Link>
        </li>
        {canArchive ? (
          <li>
            <button type="button" className={itemClass} onClick={onArchive}>
              <OptionContent
                icon={Archive}
                title={t('archive.confirm')}
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
