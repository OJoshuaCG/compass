import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { AlertTriangle, CheckCircle2, Info, XCircle } from '../icons';
import { cn } from '../lib/cn';

const alert = cva('flex items-start gap-3 rounded-md border px-4 py-3 text-sm', {
  variants: {
    tone: {
      danger: 'border-danger text-danger',
      warning: 'border-warning text-warning',
      success: 'border-success text-success',
      info: 'border-border-strong text-text',
    },
  },
  defaultVariants: { tone: 'info' },
});

const icons = { danger: XCircle, warning: AlertTriangle, success: CheckCircle2, info: Info };

// Solo el error interrumpe al lector de pantalla (`alert`, asertivo). Los avisos informativos,
// de advertencia y de éxito suelen ser notas fijas que ya están montadas al abrir un diálogo; con
// `alert` lo interrumpirían sin que la persona haya hecho nada, así que usan `status` (cortés).
const roles = { danger: 'alert', warning: 'status', success: 'status', info: 'status' } as const;

export type AlertProps = VariantProps<typeof alert> & {
  children: ReactNode;
  /** Acción opcional (por ejemplo "Reintentar"). */
  action?: ReactNode;
  className?: string;
};

/**
 * Aviso en línea. El rol depende del tono: `danger` es `role="alert"` (asertivo) y los demás
 * `role="status"` (cortés). El estado se comunica con ícono y texto, no solo con color
 * (docs/frontend.md §5.3).
 */
export function Alert({ tone = 'info', children, action, className }: AlertProps) {
  const Icon = icons[tone ?? 'info'];
  return (
    <div role={roles[tone ?? 'info']} className={cn(alert({ tone }), className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="break-words">{children}</div>
        {action !== undefined ? <div>{action}</div> : null}
      </div>
    </div>
  );
}
