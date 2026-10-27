import { Checkbox } from '@iam/ui';
import { useId } from 'react';

export type PermissionOption = { id: string; /** Ya traducido. */ label: string };
export type PermissionPickerGroup = {
  id: string;
  /** Ya traducido. */
  label: string;
  options: PermissionOption[];
};

export type PermissionPickerProps = {
  legend: string;
  help: string;
  groups: PermissionPickerGroup[];
  /** Texto que se muestra si no hay nada que elegir. */
  emptyMessage: string;
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  /** Mensaje de error ya traducido; marca el grupo como inválido. */
  error?: string | undefined;
};

/**
 * Casillas de permisos agrupadas por área. Presentacional: recibe todo traducido. Cada área es un
 * `fieldset` con leyenda dentro del `fieldset` general; el error se anuncia con `role="alert"`.
 */
export function PermissionPicker({
  legend,
  help,
  groups,
  emptyMessage,
  selected,
  onChange,
  error,
}: PermissionPickerProps) {
  const base = useId();
  const helpId = `${base}-help`;
  const errorId = `${base}-error`;
  const describedBy = error !== undefined ? `${errorId} ${helpId}` : helpId;

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selected, id] : selected.filter((value) => value !== id));
  }

  return (
    <fieldset
      aria-describedby={describedBy}
      aria-invalid={error !== undefined ? true : undefined}
      className="flex flex-col gap-3"
    >
      <legend className="text-sm font-medium text-text">
        {legend}
        <span aria-hidden="true" className="ms-1 text-danger">
          *
        </span>
      </legend>
      <p id={helpId} className="text-sm text-text-secondary">
        {help}
      </p>
      {groups.length === 0 ? <p className="text-sm text-text-secondary">{emptyMessage}</p> : null}
      <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
        {groups.map((group) => (
          <fieldset key={group.id} className="flex flex-col gap-1">
            <legend className="text-xs font-medium uppercase text-text-muted">{group.label}</legend>
            {group.options.map((option) => (
              <label key={option.id} className="flex min-h-6 items-center gap-2 text-sm text-text">
                <Checkbox
                  value={option.id}
                  checked={selected.includes(option.id)}
                  onChange={(event) => {
                    toggle(option.id, event.target.checked);
                  }}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
