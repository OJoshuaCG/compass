import { Loader2 } from 'lucide-react';

import { cn } from '../lib/cn';

export type SpinnerProps = {
  /** Texto para lectores de pantalla. Sin él, el spinner es decorativo (aria-hidden). */
  label?: string;
  className?: string;
};

/** Indicador de carga. Gira solo si el usuario no pidió reducir el movimiento. */
export function Spinner({ label, className }: SpinnerProps) {
  const icon = (
    <Loader2 aria-hidden="true" className={cn('size-4 motion-safe:animate-spin', className)} />
  );
  if (label === undefined) return icon;
  return (
    <span role="status" className="inline-flex items-center">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
