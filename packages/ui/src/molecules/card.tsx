import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/**
 * Tarjeta opaca (`surface` con borde fuerte). Nunca usa cristal: el contenido debe seguir
 * legible (docs/frontend.md §4.1, regla 2).
 */
export function Card({ className, ...rest }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('min-w-0 rounded-lg border border-border-strong bg-surface', className)}
      {...rest}
    />
  );
}

/** Cabecera de tarjeta: título y acciones, con separador inferior. */
export function CardHeader({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-4',
        className,
      )}
      {...rest}
    />
  );
}

/** Cuerpo de tarjeta con el relleno estándar. */
export function CardBody({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('p-5', className)} {...rest} />;
}
