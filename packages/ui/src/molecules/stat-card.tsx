import { cva, type VariantProps } from 'class-variance-authority';
import { useId, type ReactNode } from 'react';

import { cn } from '../lib/cn';

const statIcon = cva('', {
  variants: {
    tone: {
      accent: 'text-accent',
      success: 'text-success',
      warning: 'text-warning',
      danger: 'text-danger',
    },
  },
  defaultVariants: { tone: 'accent' },
});

export type StatCardProps = VariantProps<typeof statIcon> & {
  /** Qué se mide, ya traducido. */
  label: string;
  /** Cifra principal, ya formateada. `undefined` mientras carga (se muestra un marcador). */
  value: string | undefined;
  /** Detalle bajo la cifra. */
  hint?: string;
  /** Ícono decorativo en la esquina; el color acompaña al texto, nunca lo sustituye. */
  icon?: ReactNode;
  className?: string;
};

/** Tarjeta de métrica: etiqueta, cifra grande y un detalle. */
export function StatCard({ label, value, hint, icon, tone, className }: StatCardProps) {
  const labelId = useId();
  return (
    <section
      aria-labelledby={labelId}
      aria-busy={value === undefined}
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-card',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={labelId} className="font-sans text-sm font-semibold tracking-normal text-text">
          {label}
        </h2>
        {icon !== undefined ? (
          <span aria-hidden="true" className={statIcon({ tone })}>
            {icon}
          </span>
        ) : null}
      </div>
      <p className="font-heading text-3xl font-bold tabular-nums text-text">
        {value ?? <span className="text-text-disabled">—</span>}
      </p>
      {hint !== undefined ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </section>
  );
}
