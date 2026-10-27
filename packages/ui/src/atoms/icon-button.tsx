import { cva } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

import { buttonVariants, type ButtonProps } from './button';

const iconSize = cva('', {
  variants: { size: { sm: 'size-8', md: 'size-10', lg: 'size-12' } },
  defaultVariants: { size: 'md' },
});

export type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label' | 'children'> &
  Pick<ButtonProps, 'variant' | 'size'> & {
    /** Nombre accesible, ya traducido. Obligatorio: el botón no tiene texto visible. */
    label: string;
    icon: ReactNode;
  };

/** Botón de solo ícono; el ícono es decorativo y `label` da el nombre accesible. */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(buttonVariants({ variant, size }), iconSize({ size }), 'p-0', className)}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </button>
  );
}
