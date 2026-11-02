import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export const badgeVariants = cva(
  // Rellena con el fondo suave de su tono, como el diseño de Compass; los pares texto/fondo están
  // medidos en la prueba de contraste de los tokens.
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold',
  {
    variants: {
      tone: {
        neutral: 'bg-canvas text-text-secondary',
        accent: 'bg-raised text-accent',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

/** Etiqueta compacta. El color nunca es el único canal: incluye siempre texto. */
export function Badge({ tone, className, ...rest }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...rest} />;
}
