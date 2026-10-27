import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

import { Spinner } from './spinner';

/** Variantes compartidas con IconButton: un solo lugar define el aspecto de un botón. */
export const buttonVariants = cva(
  [
    'relative inline-flex min-h-6 min-w-6 items-center justify-center gap-2 rounded-md font-medium',
    'transition-colors duration-fast',
    'disabled:cursor-not-allowed disabled:bg-raised disabled:text-text-disabled',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-accent-solid text-on-accent hover:bg-accent-solid-hover active:bg-accent-solid-hover',
        secondary:
          'border border-border-input bg-surface text-text hover:bg-raised active:bg-overlay',
        ghost: 'bg-transparent text-text hover:bg-raised active:bg-overlay',
        danger: 'bg-danger-solid text-on-accent hover:opacity-90 active:opacity-80',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /**
     * Deshabilita el botón, anuncia `aria-busy` y muestra un spinner sin cambiar el ancho:
     * el texto sigue en el DOM (nombre accesible estable) pero invisible.
     */
    loading?: boolean;
  };

/** Botón estándar. Estados: default, hover, focus-visible, active, disabled y loading. */
export function Button({
  variant,
  size,
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    >
      <span className={cn('inline-flex items-center gap-2', loading && 'opacity-0')}>
        {children}
      </span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      ) : null}
    </button>
  );
}
