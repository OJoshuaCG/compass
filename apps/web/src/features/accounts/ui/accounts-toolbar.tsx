import type { AccountListFilter } from '@iam/contracts';
import { Button, SearchInput } from '@iam/ui';
import { useTranslation } from 'react-i18next';

export type AccountsToolbarProps = {
  /** Texto del campo de búsqueda (borrador, aún sin enviar). */
  searchDraft: string;
  onSearchChange: (value: string) => void;
  /** Filtro rápido activo; `undefined` = todas. */
  filter: AccountListFilter | undefined;
  onFilterChange: (filter: AccountListFilter | undefined) => void;
  /** El inventario no ofrece filtros rápidos: revelarían datos de credenciales que no puede ver. */
  showQuickFilters: boolean;
};

/** Búsqueda y fichas de filtro rápido de los listados de cuentas. Presentacional. */
export function AccountsToolbar({
  searchDraft,
  onSearchChange,
  filter,
  onFilterChange,
  showQuickFilters,
}: AccountsToolbarProps) {
  const { t } = useTranslation(['accounts', 'common']);

  const chips: { value: AccountListFilter | undefined; label: string }[] = [
    { value: undefined, label: t('filter.all', { ns: 'accounts' }) },
    { value: 'review', label: t('filter.review', { ns: 'accounts' }) },
    { value: 'no-2fa', label: t('filter.no2fa', { ns: 'accounts' }) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <SearchInput
        className="w-full max-w-sm"
        label={t('search.label', { ns: 'accounts' })}
        clearLabel={t('search.clear', { ns: 'common' })}
        placeholder={t('search.placeholder', { ns: 'accounts' })}
        value={searchDraft}
        onValueChange={onSearchChange}
      />
      {showQuickFilters ? (
        <div role="group" aria-label={t('filter.label', { ns: 'accounts' })} className="flex gap-2">
          {chips.map((chip) => {
            const isActive = chip.value === filter;
            return (
              <Button
                key={chip.label}
                size="sm"
                variant={isActive ? 'primary' : 'secondary'}
                aria-pressed={isActive}
                onClick={() => {
                  onFilterChange(chip.value);
                }}
              >
                {chip.label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
