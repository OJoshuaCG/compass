import { Button, IconButton, Input, Plus, X } from '@iam/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

export type UriListFieldProps = {
  /** Etiqueta del grupo, ya traducida. */
  label: string;
  help: string;
  /** Mensaje de error ya traducido del grupo completo. */
  error?: string | undefined;
  required?: boolean;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
};

/**
 * Lista editable de direcciones: un campo por fila con «Quitar» y «Agregar dirección». No existe
 * un campo multilínea en `@iam/ui`, y una fila por dirección deja la etiqueta, el error y el
 * objetivo táctil de cada una sin inventar un componente nuevo.
 */
export function UriListField({
  label,
  help,
  error,
  required = false,
  values,
  onChange,
  max,
}: UriListFieldProps) {
  const { t } = useTranslation('oidcClients');
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = error === undefined ? helpId : `${errorId} ${helpId}`;

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="text-sm font-medium text-text">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-1 text-danger">
            *
          </span>
        ) : null}
      </legend>
      <ul className="flex flex-col gap-2">
        {values.map((value, index) => {
          const position = index + 1;
          return (
            // El índice es la identidad de la fila: no hay otro dato estable y las filas no se reordenan.
            <li key={index} className="flex items-center gap-2">
              <Input
                value={value}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                invalid={error !== undefined}
                aria-label={t('uri.item', { label, position })}
                aria-describedby={describedBy}
                aria-required={required || undefined}
                className="min-w-0 flex-1 font-mono"
                onChange={(event) => {
                  onChange(
                    values.map((current, at) => (at === index ? event.target.value : current)),
                  );
                }}
              />
              {values.length > 1 || !required ? (
                <IconButton
                  variant="ghost"
                  label={t('uri.remove', { label, position })}
                  icon={<X className="size-4" />}
                  onClick={() => {
                    onChange(values.filter((_, at) => at !== index));
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={values.length >= max}
          onClick={() => {
            onChange([...values, '']);
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t('uri.add')}
        </Button>
      </div>
      <p id={helpId} className="text-sm text-text-secondary">
        {help}
      </p>
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
