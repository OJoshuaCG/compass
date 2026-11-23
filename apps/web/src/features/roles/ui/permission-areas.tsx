import { Button, Checkbox, cn } from '@iam/ui';
import { useId } from 'react';

import type { PermissionPickerGroup } from './permission-picker';

export type PermissionAreasProps = {
  /** Áreas con sus permisos, ya traducidos y en el orden del catálogo. */
  groups: PermissionPickerGroup[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  /** Solo lectura: las casillas se muestran sin poder cambiarse y no hay "Seleccionar todos". */
  readOnly?: boolean;
  /** Texto si no hay nada que mostrar, ya traducido. */
  emptyMessage: string;
  /** Textos de la acción por área, ya traducidos y con el nombre del área. */
  selectAllLabel: (area: string) => string;
  clearAllLabel: (area: string) => string;
  selectAllText: string;
  clearAllText: string;
  /** Mensaje de error ya traducido. */
  error?: string | undefined;
  /** Id del texto de ayuda del panel, para describir el grupo. */
  describedBy?: string | undefined;
};

/**
 * Permisos de un rol por área, como el editor de roles del diseño de Compass: cada área con su
 * "Seleccionar todos" (o "Quitar todos" si ya están todos) y las casillas en una cuadrícula.
 * Presentacional: quién puede otorgar qué lo decide el container (y siempre el servidor).
 */
export function PermissionAreas({
  groups,
  selected,
  onChange,
  readOnly = false,
  emptyMessage,
  selectAllLabel,
  clearAllLabel,
  selectAllText,
  clearAllText,
  error,
  describedBy,
}: PermissionAreasProps) {
  const base = useId();
  const errorId = `${base}-error`;
  const describedByIds =
    [error !== undefined ? errorId : undefined, describedBy].filter(Boolean).join(' ') || undefined;

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selected, id] : selected.filter((value) => value !== id));
  }

  function toggleArea(ids: readonly string[], all: boolean) {
    onChange(
      all
        ? selected.filter((value) => !ids.includes(value))
        : [...selected, ...ids.filter((id) => !selected.includes(id))],
    );
  }

  if (groups.length === 0) return <p className="text-sm text-text-secondary">{emptyMessage}</p>;

  return (
    <div className="flex flex-col gap-6" aria-describedby={describedByIds} role="group">
      {groups.map((group) => {
        const ids = group.options.map((option) => option.id);
        const all = ids.every((id) => selected.includes(id));
        return (
          <fieldset key={group.id} className="flex flex-col gap-2">
            {/* La leyenda debe ser hija directa del fieldset; a la vista va el mismo texto. */}
            <legend className="sr-only">{group.label}</legend>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
              <span
                aria-hidden="true"
                className="text-xs font-semibold tracking-wide text-text-muted uppercase"
              >
                {group.label}
              </span>
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-accent"
                  aria-label={all ? clearAllLabel(group.label) : selectAllLabel(group.label)}
                  onClick={() => {
                    toggleArea(ids, all);
                  }}
                >
                  {all ? clearAllText : selectAllText}
                </Button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.options.map((option) => {
                const on = selected.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-text',
                      on ? 'bg-raised' : 'bg-surface',
                      readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-raised',
                    )}
                  >
                    <Checkbox
                      value={option.id}
                      checked={on}
                      disabled={readOnly}
                      onChange={(event) => {
                        toggle(option.id, event.target.checked);
                      }}
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
