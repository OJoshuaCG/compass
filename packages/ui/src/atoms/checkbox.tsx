import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'>;

/**
 * Casilla nativa: teclado y lectores de pantalla funcionan sin código extra. Siempre va con
 * una etiqueta asociada (`<label htmlFor>` o envolviéndola). `accent-*` colorea el control
 * nativo con el token de marca y el área es de 24 px (WCAG 2.5.8).
 */
export function Checkbox({ className, ...rest }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={cn(
        'size-6 shrink-0 cursor-pointer accent-accent-solid disabled:cursor-not-allowed',
        className,
      )}
      {...rest}
    />
  );
}
