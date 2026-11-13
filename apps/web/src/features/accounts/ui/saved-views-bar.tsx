import type { SavedAccountView } from '@iam/contracts';
import { Button, NativeSelect } from '@iam/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

export type SavedViewsBarProps = {
  views: readonly SavedAccountView[];
  /** Vista cuyos criterios coinciden con los aplicados; `undefined` = ninguna. */
  activeViewId: string | undefined;
  /** `undefined` = "sin vista": limpia texto y filtro. */
  onSelect: (view: SavedAccountView | undefined) => void;
  /** «Guardar vista» solo tiene sentido con texto o filtro aplicado. */
  canSave: boolean;
  onSave: () => void;
  onDelete: (view: SavedAccountView) => void;
};

/**
 * Selector de vistas guardadas y sus acciones. «Guardar vista» y «Borrar vista» son acciones
 * secundarias (nunca el botón principal de la pantalla). Presentacional.
 */
export function SavedViewsBar({
  views,
  activeViewId,
  onSelect,
  canSave,
  onSave,
  onDelete,
}: SavedViewsBarProps) {
  const { t } = useTranslation('accounts');
  const selectId = useId();
  const activeView = views.find((view) => view.id === activeViewId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={selectId} className="text-sm font-medium text-text">
        {t('views.label')}
      </label>
      <NativeSelect
        id={selectId}
        size="sm"
        value={activeView?.id ?? ''}
        onChange={(event) => {
          onSelect(views.find((view) => view.id === event.target.value));
        }}
      >
        <option value="">{t('views.none')}</option>
        {views.map((view) => (
          <option key={view.id} value={view.id}>
            {view.name}
          </option>
        ))}
      </NativeSelect>
      <Button size="sm" variant="secondary" disabled={!canSave} onClick={onSave}>
        {t('views.save')}
      </Button>
      {activeView !== undefined ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('views.deleteLabel', { name: activeView.name })}
          onClick={() => {
            onDelete(activeView);
          }}
        >
          {t('views.delete')}
        </Button>
      ) : null}
    </div>
  );
}
