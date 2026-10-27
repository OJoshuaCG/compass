import type { ComponentProps } from 'react';

import { Input } from '../atoms/input';
import { cn } from '../lib/cn';

export type CodeInputProps = Omit<
  ComponentProps<typeof Input>,
  'type' | 'value' | 'onChange' | 'maxLength' | 'inputMode' | 'pattern'
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Cantidad de dígitos del código (6 para TOTP). */
  length?: number;
};

/**
 * Código numérico de N dígitos. Un solo `<input>` (no N casillas): lectores de pantalla,
 * pegado y autocompletado de códigos de un solo uso (`one-time-code`) funcionan de forma nativa.
 * Descarta lo que no sea dígito, también al pegar (por ejemplo "123 456").
 */
export function CodeInput({
  value,
  onValueChange,
  length = 6,
  className,
  ...rest
}: CodeInputProps) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern={`[0-9]{${String(length)}}`}
      maxLength={length + 4}
      spellCheck={false}
      value={value}
      onChange={(event) => {
        onValueChange(event.target.value.replace(/\D/g, '').slice(0, length));
      }}
      className={cn('text-center font-mono text-lg tracking-widest tabular-nums', className)}
      {...rest}
    />
  );
}
