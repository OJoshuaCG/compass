import type { Role } from '@iam/contracts';
import { Checkbox } from '@iam/ui';
import { useId } from 'react';

export type RoleChoicesProps = {
  /** Texto ya traducido de la leyenda del grupo. */
  legend: string;
  help: string;
  roles: readonly Role[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
};

/**
 * Grupo de casillas de roles personalizados. Un `fieldset` con leyenda da el nombre al grupo para
 * los lectores de pantalla; cada casilla lleva su etiqueta y la ayuda se enlaza al grupo.
 */
export function RoleChoices({ legend, help, roles, selected, onChange }: RoleChoicesProps) {
  const helpId = useId();
  return (
    <fieldset aria-describedby={helpId} className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-text">{legend}</legend>
      <p id={helpId} className="text-sm text-text-secondary">
        {help}
      </p>
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {roles.map((role) => (
          <li key={role.id}>
            <label className="flex min-h-6 items-center gap-2 text-sm text-text">
              <Checkbox
                value={role.id}
                checked={selected.includes(role.id)}
                onChange={(event) => {
                  onChange(
                    event.target.checked
                      ? [...selected, role.id]
                      : selected.filter((id) => id !== role.id),
                  );
                }}
              />
              {role.name}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
