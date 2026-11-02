import { AlertTriangle, CheckCircle2, Circle, Info, XCircle } from 'lucide-react';

import { cn } from '../lib/cn';

export type Status = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const config = {
  success: { className: 'text-success', Icon: CheckCircle2 },
  warning: { className: 'text-warning', Icon: AlertTriangle },
  danger: { className: 'text-danger', Icon: XCircle },
  info: { className: 'text-accent', Icon: Info },
  neutral: { className: 'text-text-muted', Icon: Circle },
} as const;

export type StatusBadgeProps = {
  status: Status;
  /** Etiqueta ya traducida. */
  label: string;
};

/**
 * Estado en línea, sin recuadro, como el diseño de Compass. Nunca se comunica solo con color: ícono
 * + texto + color (docs/frontend.md §5.3).
 */
export function StatusBadge({ status, label }: StatusBadgeProps) {
  const { className, Icon } = config[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', className)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {label}
    </span>
  );
}
