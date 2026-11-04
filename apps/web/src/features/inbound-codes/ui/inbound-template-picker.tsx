import { MAX_TEMPLATES_PER_VIEW, type InboundTemplateSummary } from '@iam/contracts';
import { Checkbox } from '@iam/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

export type InboundTemplatePickerProps = {
  templates: readonly InboundTemplateSummary[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  /** Mensaje ya traducido del error de validación del grupo. */
  error?: string | undefined;
};

/**
 * Grupo de casillas de plantillas. Un `fieldset` con leyenda da nombre al grupo para los lectores
 * de pantalla; la ayuda y el error se enlazan con `aria-describedby`. El error se anuncia al aparecer.
 */
export function InboundTemplatePicker({
  templates,
  selected,
  onChange,
  error,
}: InboundTemplatePickerProps) {
  const { t } = useTranslation('inbound');
  const helpId = useId();
  const errorId = useId();
  const describedBy = error === undefined ? helpId : `${errorId} ${helpId}`;

  return (
    <fieldset aria-describedby={describedBy} className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-text">
        {t('viewSettings.form.templates')}
        <span aria-hidden="true" className="ms-1 text-danger">
          *
        </span>
      </legend>
      <p id={helpId} className="text-sm text-text-secondary">
        {templates.length === 0
          ? t('viewSettings.form.templatesNone')
          : t('viewSettings.form.templatesHelp')}
      </p>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border-strong bg-raised p-2">
        {templates.map((template) => (
          <li key={template.id}>
            <label className="flex min-h-6 items-center gap-2 text-sm text-text">
              <Checkbox
                value={template.id}
                checked={selected.includes(template.id)}
                onChange={(event) => {
                  onChange(
                    event.target.checked
                      ? [...selected, template.id]
                      : selected.filter((id) => id !== template.id),
                  );
                }}
              />
              {t('viewSettings.template.label', {
                name: template.name,
                kind: t(`templateKind.${template.kind}`),
              })}
            </label>
          </li>
        ))}
      </ul>
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

type FieldErrorLike = { type?: string | number | undefined; message?: string | undefined };

/**
 * Traduce el error de validación del grupo de plantillas. Zod habla en inglés, así que se traduce
 * por el tipo de incidencia; el error del servidor (`type: 'server'`) ya llega traducido.
 */
export function useTemplatesErrorMessage(): (
  error: FieldErrorLike | undefined,
) => string | undefined {
  const { t } = useTranslation('inbound');
  return (error) => {
    if (error === undefined) return undefined;
    if (error.type === 'server' && error.message !== undefined) return error.message;
    if (error.type === 'too_big') {
      return t('viewSettings.form.templatesTooMany', { max: MAX_TEMPLATES_PER_VIEW });
    }
    return t('viewSettings.form.templatesRequired');
  };
}
