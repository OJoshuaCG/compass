import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export type InputProps = ComponentProps<'input'> & {
  /** Marca el campo como inválido (`aria-invalid`) y resalta el borde. */
  invalid?: boolean;
};

/** Campo de texto. Siempre debe llevar etiqueta (usa FormField o `aria-label`). */
export function Input({ invalid = false, className, type = 'text', ...rest }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-md border bg-surface px-3 text-sm text-text placeholder:text-text-muted',
        'transition-colors duration-fast hover:bg-raised',
        'disabled:cursor-not-allowed disabled:text-text-disabled disabled:placeholder:text-text-disabled',
        invalid ? 'border-danger' : 'border-border-input',
        className,
      )}
      {...rest}
    />
  );
}
