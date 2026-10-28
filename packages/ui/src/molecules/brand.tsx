import { Compass } from 'lucide-react';

import { cn } from '../lib/cn';

export type BrandProps = {
  /** Nombre del producto, ya traducido. */
  name: string;
  className?: string;
};

/**
 * Marca del producto: isotipo de brújula en un cuadro claro y el nombre. Pensada para fondos
 * de navegación (azul marino): el texto toma el color del contenedor.
 */
export function Brand({ name, className }: BrandProps) {
  return (
    <span className={cn('flex items-center gap-2.5 text-lg font-bold', className)}>
      <span className="flex size-8 items-center justify-center rounded-md bg-surface text-nav">
        <Compass aria-hidden="true" className="size-5" />
      </span>
      {name}
    </span>
  );
}
