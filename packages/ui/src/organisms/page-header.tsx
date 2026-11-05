import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type PageHeaderProps = {
  title: string;
  description?: string;
  /** Acciones de la página (botones), alineadas al final. */
  actions?: ReactNode;
  className?: string;
};

/** Título de página (h1, con la fuente de encabezados vía capa base) y acciones. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl text-text">{title}</h1>
        {description !== undefined ? (
          <p className="text-sm text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
