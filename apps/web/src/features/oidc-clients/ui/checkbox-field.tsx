import { Checkbox } from '@iam/ui';
import { useId } from 'react';

export type CheckboxFieldProps = {
  label: string;
  help: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/** Casilla con etiqueta y ayuda enlazadas; la fila entera mide al menos 40 px de alto en móvil. */
export function CheckboxField({ label, help, checked, onChange }: CheckboxFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        aria-describedby={helpId}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium break-words text-text">
          {label}
        </label>
        <p id={helpId} className="text-sm text-text-secondary">
          {help}
        </p>
      </div>
    </div>
  );
}
