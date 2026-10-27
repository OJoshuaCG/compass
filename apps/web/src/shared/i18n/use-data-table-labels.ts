import type { DataTableLabels } from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Etiquetas traducidas que exige `DataTable`: un solo lugar para todas las tablas. */
export function useDataTableLabels(): DataTableLabels {
  const { t } = useTranslation('common');
  return useMemo(
    () => ({
      pagination: {
        navigation: t('table.pagination'),
        previous: t('table.previous'),
        next: t('table.next'),
        rowsPerPage: t('table.rowsPerPage'),
      },
      range: ({ from, to, total }) =>
        total === undefined
          ? t('table.range', { from, to })
          : t('table.rangeOfTotal', { from, to, total }),
      actionsColumn: t('table.actionsColumn'),
      loading: t('table.loading'),
      retry: t('actions.retry'),
      emptyFiltered: {
        title: t('table.emptyFiltered.title'),
        description: t('table.emptyFiltered.description'),
        clear: t('table.clearFilters'),
      },
    }),
    [t],
  );
}
