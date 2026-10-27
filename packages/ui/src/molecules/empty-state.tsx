import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Acción sugerida (normalmente un Button). */
  action?: ReactNode;
  className?: string;
};

/** Estado vacío con una acción sugerida. */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-10 text-center', className)}>
      {icon !== undefined ? (
        <div aria-hidden="true" className="text-text-muted">
          {icon}
        </div>
      ) : null}
      <p className="font-heading text-lg text-text">{title}</p>
      {description !== undefined ? (
        <p className="max-w-prose text-sm text-text-secondary">{description}</p>
      ) : null}
      {action !== undefined ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
