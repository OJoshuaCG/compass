import { AlertTriangle, CheckCircle2, Circle, Info, XCircle } from 'lucide-react';

import { Badge } from '../atoms/badge';

export type Status = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const config = {
  success: { tone: 'success', Icon: CheckCircle2 },
  warning: { tone: 'warning', Icon: AlertTriangle },
  danger: { tone: 'danger', Icon: XCircle },
  info: { tone: 'accent', Icon: Info },
  neutral: { tone: 'neutral', Icon: Circle },
} as const;

export type StatusBadgeProps = {
  status: Status;
  /** Etiqueta ya traducida. */
  label: string;
};

/** El estado nunca se comunica solo con color: ícono + texto + color (docs/frontend.md §5.3). */
export function StatusBadge({ status, label }: StatusBadgeProps) {
  const { tone, Icon } = config[status];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </Badge>
  );
}
