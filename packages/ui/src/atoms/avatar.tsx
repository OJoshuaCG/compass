import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

const avatar = cva(
  'inline-flex shrink-0 items-center justify-center rounded-full bg-overlay font-heading font-semibold text-text ring-1 ring-inset ring-border-strong',
  {
    variants: { size: { sm: 'size-7 text-xs', md: 'size-8 text-xs' } },
    defaultVariants: { size: 'md' },
  },
);

const MAX_INITIALS = 2;

/** Primeras letras de las primeras palabras del nombre, en mayúsculas ("Cero User" -> "CU"). */
export function initialsOf(name: string): string {
  const words: string[] = name.trim().split(/\s+/);
  const letters: string[] = [];
  for (const word of words) {
    const firstCharacter: string | undefined = Array.from(word)[0];
    if (firstCharacter !== undefined) letters.push(firstCharacter);
    if (letters.length === MAX_INITIALS) break;
  }
  return letters.join('').toUpperCase();
}

export type AvatarProps = Omit<ComponentProps<'span'>, 'children'> &
  VariantProps<typeof avatar> & {
    /** Nombre de la persona. El avatar es decorativo: el nombre siempre va escrito al lado. */
    name: string;
  };

/** Círculo con las iniciales. Oculto para lectores de pantalla porque repite el nombre visible. */
export function Avatar({ name, size, className, ...rest }: AvatarProps) {
  return (
    <span aria-hidden="true" className={cn(avatar({ size }), className)} {...rest}>
      {initialsOf(name)}
    </span>
  );
}
