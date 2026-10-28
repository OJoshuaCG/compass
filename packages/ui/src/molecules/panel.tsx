import { useId, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export type PanelProps = {
  /** Título del panel (h2), ya traducido. */
  title: string;
  /** Contenido al final del encabezado: un contador, un estado o una acción. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Tarjeta con encabezado separado por una línea; el cuerpo no lleva relleno propio. */
export function Panel({ title, aside, children, className }: PanelProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col rounded-lg border border-border bg-surface shadow-card',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id={titleId} className="text-base text-text">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
