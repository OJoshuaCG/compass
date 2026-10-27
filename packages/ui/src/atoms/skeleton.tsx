import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export type SkeletonProps = ComponentProps<'div'>;

/** Marcador de carga decorativo; el contenedor que lo usa anuncia el estado. */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('h-4 rounded-sm bg-raised motion-safe:animate-pulse', className)}
      {...rest}
    />
  );
}
