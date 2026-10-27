import { useId } from 'react';

import { cn } from '../lib/cn';

export type RadioOption = {
  value: string;
  /** Ya traducido. */
  label: string;
  /** Texto de apoyo opcional (por ejemplo, el correo). */
  description?: string;
};

export type RadioGroupProps = {
  /** Título del grupo para lectores de pantalla y vista (ya traducido). */
  legend: string;
  options: readonly RadioOption[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  className?: string;
};

/**
 * Grupo de opciones excluyentes con radios nativos (flechas, Tab y lectores de pantalla sin
 * código extra). Cada radio tiene un área de 24 px (WCAG 2.5.8) y el color de marca.
 */
export function RadioGroup({ legend, options, value, onValueChange, className }: RadioGroupProps) {
  const name = useId();
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-1', className)}>
      <legend className="mb-1 text-sm font-medium text-text">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex min-h-8 cursor-pointer items-center gap-3 rounded-md px-2 py-1 hover:bg-raised"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              onValueChange(option.value);
            }}
            className="size-6 shrink-0 cursor-pointer accent-accent-solid"
          />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm text-text">{option.label}</span>
            {option.description !== undefined ? (
              <span className="break-words text-xs text-text-secondary">{option.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
