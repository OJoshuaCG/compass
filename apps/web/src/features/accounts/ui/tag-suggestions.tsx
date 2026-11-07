import { Button } from '@iam/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

export type TagSuggestionsProps = {
  /** Etiquetas existentes que completan lo escrito (ya filtradas por `suggestTags`). */
  suggestions: readonly string[];
  onPick: (tag: string) => void;
};

/**
 * Etiquetas existentes que se pueden agregar con un clic, debajo del campo de etiquetas. Son botones
 * y no un menú desplegable: se alcanzan con el tabulador y no ocultan el resto del formulario.
 */
export function TagSuggestions({ suggestions, onPick }: TagSuggestionsProps) {
  const { t } = useTranslation('accounts');
  const labelId = useId();
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-xs text-text-secondary">
        {t('form.tagsSuggestions')}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {suggestions.map((tag) => (
          <Button
            key={tag}
            size="sm"
            variant="secondary"
            aria-label={t('form.tagsSuggestionAdd', { tag })}
            onClick={() => {
              onPick(tag);
            }}
          >
            {tag}
          </Button>
        ))}
      </div>
    </div>
  );
}
