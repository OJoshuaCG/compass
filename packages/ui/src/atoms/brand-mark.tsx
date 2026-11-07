import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export type BrandMarkProps = Omit<ComponentProps<'svg'>, 'children' | 'aria-hidden'>;

/**
 * Brújula de Compass: aro y aguja sur con el color del texto actual, aguja norte con el acento
 * (la «aguja de latón», docs/frontend.md §4.1). Es decorativa: el nombre de la marca va escrito
 * al lado, así que se oculta a los lectores de pantalla. El tamaño base (24 px) fija las
 * dimensiones y evita saltos de diseño.
 */
export function BrandMark({ className, ...rest }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 text-text', className)}
      {...rest}
    >
      <circle
        cx="12"
        cy="12"
        r="10.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.55"
      />
      <g transform="rotate(40 12 12)">
        <path d="M12 3.8l2.6 8.2H9.4z" className="fill-accent" />
        <path d="M12 20.2L14.6 12H9.4z" fill="currentColor" opacity="0.45" />
      </g>
      <circle cx="12" cy="12" r="1.3" className="fill-canvas" />
    </svg>
  );
}
