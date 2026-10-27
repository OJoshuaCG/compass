import { useState } from 'react';

import { Button, type ButtonProps } from '../atoms/button';
import { Check, Copy } from '../icons';

export type CopyButtonProps = Omit<ButtonProps, 'onClick' | 'children' | 'loading'> & {
  /** Texto a copiar. */
  value: string;
  label: string;
  /** Anuncio (aria-live) y texto tras copiar. */
  copiedLabel: string;
  /** Anuncio si el navegador rechaza el acceso al portapapeles. */
  failedLabel: string;
  /**
   * Para secretos: limpia el portapapeles pasado este tiempo (mejor esfuerzo, docs/frontend.md §9).
   * Si el portapapeles ya contiene otra cosa, no se toca.
   */
  clearAfterMs?: number;
};

/**
 * Botón que copia un texto. El resultado se anuncia en una región `role="status"` para
 * lectores de pantalla, no solo con el cambio de ícono.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  failedLabel,
  clearAfterMs,
  variant = 'secondary',
  ...rest
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      if (clearAfterMs !== undefined) {
        // El temporizador no se cancela al desmontar: el objetivo es limpiar el secreto
        // aunque el usuario ya haya cambiado de pantalla.
        window.setTimeout(() => {
          void (async () => {
            try {
              if ((await navigator.clipboard.readText()) === value) {
                await navigator.clipboard.writeText('');
              }
            } catch {
              // Sin permiso de lectura: se sobrescribe a ciegas, que es lo mejor posible.
              await navigator.clipboard.writeText('').catch(() => undefined);
            }
          })();
        }, clearAfterMs);
      }
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <Button
        variant={variant}
        onClick={() => {
          void copy();
        }}
        {...rest}
      >
        {state === 'copied' ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
        {label}
      </Button>
      <span role="status" className="sr-only">
        {state === 'copied' ? copiedLabel : state === 'failed' ? failedLabel : ''}
      </span>
    </>
  );
}
