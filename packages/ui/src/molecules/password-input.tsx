import { useState, type ComponentProps } from 'react';

import { Input } from '../atoms/input';
import { cn } from '../lib/cn';
import { Eye, EyeOff } from '../icons';

export type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type'> & {
  /** Nombre accesible del botón cuando la contraseña está oculta (ya traducido). */
  showLabel: string;
  /** Nombre accesible del botón cuando la contraseña está visible (ya traducido). */
  hideLabel: string;
};

/**
 * Campo de contraseña con mostrar/ocultar. El botón usa `aria-pressed` y mantiene un nombre
 * estable por estado; no sale del orden natural de tabulación. Recuerda pasar el
 * `autoComplete` correcto (`current-password` o `new-password`).
 */
export function PasswordInput({ showLabel, hideLabel, className, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        // Sin autocorrección: una contraseña mostrada no debe pasar por correctores del teclado.
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn('pe-11', className)}
        {...rest}
      />
      <button
        type="button"
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        onClick={() => {
          setVisible((current) => !current);
        }}
        className="absolute end-1 top-1 inline-flex size-8 items-center justify-center rounded-sm text-text-secondary hover:bg-raised hover:text-text"
      >
        <Icon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
