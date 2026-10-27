import { useId, type ReactNode } from 'react';

import { cn } from '../lib/cn';

/** Atributos que FormField entrega al control para enlazar etiqueta, ayuda y error. */
export type FormFieldControlProps = {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
};

export type FormFieldProps = {
  label: string;
  help?: string;
  /** Mensaje de error ya traducido; su presencia marca el campo como inválido. */
  error?: string | undefined;
  required?: boolean;
  className?: string;
  /** Render-prop: evita clonar elementos y mantiene los tipos del control. */
  children: (controlProps: FormFieldControlProps) => ReactNode;
};

/**
 * Etiqueta + control + ayuda + error. Enlaza todo con `aria-describedby` y `aria-invalid`
 * (docs/frontend.md §8). El error se anuncia con `role="alert"` al aparecer.
 */
export function FormField({
  label,
  help,
  error,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [error !== undefined ? errorId : null, help !== undefined ? helpId : null]
    .filter((v): v is string => v !== null)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-1 text-danger">
            *
          </span>
        ) : null}
      </label>
      {children({
        id,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error !== undefined ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {help !== undefined ? (
        <p id={helpId} className="text-sm text-text-secondary">
          {help}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
