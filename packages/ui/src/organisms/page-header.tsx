import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type PageHeaderProps = {
  title: string;
  description?: string;
  /** Etiqueta pequeña sobre el título (sección o contexto), ya traducida. */
  eyebrow?: string;
  /** Acciones de la página (botones), alineadas al final; envuelven en pantallas estrechas. */
  actions?: ReactNode;
  className?: string;
};

/**
 * Encabezado de página: etiqueta opcional, título (h1, con la fuente de encabezados vía capa
 * base), texto de apoyo y acciones a la derecha.
 */
export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-8 gap-y-5', className)}>
      {/* basis-90 (22.5 rem): el texto cede ancho a las acciones antes de apretarse demasiado. */}
      <div className="flex min-w-0 flex-1 basis-90 flex-col gap-2.5">
        {eyebrow !== undefined ? (
          <p className="font-mono text-xs font-medium tracking-widest text-text-muted uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-semibold text-text">{title}</h1>
        {description !== undefined ? (
          <p className="max-w-prose text-base text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
      ) : null}
    </div>
  );
}
