import { useEffect, useRef, useState } from 'react';

import { Button, type ButtonProps } from '../atoms/button';
import { Check, Copy } from '../icons';

/** Tiempo que el estado "copiado" permanece visible antes de volver a `idle`. */
const DEFAULT_ANNOUNCE_RESET_MS = 3000;

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
  /** Cuánto tiempo se muestra "copiado" antes de volver a reposo (3 s por defecto). */
  announceResetMs?: number;
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
  announceResetMs = DEFAULT_ANNOUNCE_RESET_MS,
  variant = 'secondary',
  ...rest
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Un lector de pantalla no repite un texto idéntico en una región en vivo: se alterna un
  // carácter invisible para que cada copia se anuncie, y el estado vuelve a `idle` tras unos s.
  const [tick, setTick] = useState(0);
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => {
      window.clearTimeout(resetTimer.current);
    };
  }, []);

  function announce(next: 'copied' | 'failed') {
    window.clearTimeout(resetTimer.current);
    setTick((current) => current + 1);
    setState(next);
    resetTimer.current = window.setTimeout(() => {
      setState('idle');
    }, announceResetMs);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      announce('copied');
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
              // Sin permiso de lectura no se puede verificar que el portapapeles aún contenga
              // el secreto: no se toca, para no destruir lo que el usuario copió después.
            }
          })();
        }, clearAfterMs);
      }
    } catch {
      announce('failed');
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
      {/* Texto visible para quien ve la pantalla (el ícono solo no basta, WCAG 1.4.1). Va oculto
          al lector de pantalla porque la región `status` de abajo ya lo anuncia; mostrarlo en
          ambos lados lo leería dos veces. Dura lo mismo que el estado (`announceResetMs`). */}
      {state === 'idle' ? null : (
        <span
          aria-hidden="true"
          className={state === 'copied' ? 'text-sm text-success' : 'text-sm text-danger'}
        >
          {state === 'copied' ? copiedLabel : failedLabel}
        </span>
      )}
      <span role="status" className="sr-only">
        {state === 'idle'
          ? ''
          : `${state === 'copied' ? copiedLabel : failedLabel}${tick % 2 === 0 ? '\u200b' : ''}`}
      </span>
    </>
  );
}
