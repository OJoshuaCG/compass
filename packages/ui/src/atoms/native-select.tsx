import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

const nativeSelect = cva(
  'rounded-md border bg-surface px-2 text-text transition-colors duration-fast hover:bg-raised disabled:cursor-not-allowed disabled:text-text-disabled',
  {
    variants: {
      size: { sm: 'h-8 text-sm', md: 'h-10 text-sm' },
      invalid: { true: 'border-danger', false: 'border-border-input' },
    },
    defaultVariants: { size: 'md', invalid: false },
  },
);

export type NativeSelectProps = Omit<ComponentProps<'select'>, 'size'> &
  Pick<VariantProps<typeof nativeSelect>, 'size'> & { invalid?: boolean };

/**
 * Selector nativo: teclado, lectores de pantalla y móviles funcionan sin código extra.
 * Se prefiere al Select de Radix cuando no hace falta contenido enriquecido en las opciones.
 */
export function NativeSelect({ size, invalid = false, className, ...rest }: NativeSelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(nativeSelect({ size, invalid }), className)}
      {...rest}
    />
  );
}
