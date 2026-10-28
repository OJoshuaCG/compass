import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export const iconBubbleVariants = cva(
  'flex size-9 shrink-0 items-center justify-center rounded-full',
  {
    variants: {
      tone: {
        accent: 'bg-raised text-accent',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
      },
    },
    defaultVariants: { tone: 'accent' },
  },
);

export type IconBubbleProps = VariantProps<typeof iconBubbleVariants> & {
  /** Ícono decorativo: el texto vecino siempre explica el estado (el color no es el único canal). */
  icon: ReactNode;
  className?: string;
};

/** Ícono dentro de un círculo con el fondo suave de su estado. */
export function IconBubble({ icon, tone, className }: IconBubbleProps) {
  return (
    <span aria-hidden="true" className={cn(iconBubbleVariants({ tone }), className)}>
      {icon}
    </span>
  );
}
