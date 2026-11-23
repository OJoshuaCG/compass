import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageHeader,
  SearchInput,
  StatusBadge,
  type Column,
  DataTable,
  type Status,
  Settings,
  Trash2,
} from '@iam/ui';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels, useErrorMessage } from '../../../shared/i18n';
import { useTableQuery, type TableSearch } from '../../../shared/api';
import { createDemoFetcher, type DemoUser } from '../model/demo-data';

const STATUS_TONE: Record<DemoUser['status'], Status> = {
  active: 'success',
  pending: 'warning',
  failed: 'danger',
  inactive: 'neutral',
};

export type CatalogPageProps = {
  search: TableSearch;
  onSearchChange: (patch: Partial<TableSearch>) => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg text-text">{title}</h2>
      {children}
    </section>
  );
}

/** Catálogo visual de desarrollo (sin Storybook): componentes compartidos y sus estados. */
export function CatalogPage({ search, onSearchChange }: CatalogPageProps) {
  const { t } = useTranslation('common');
  const labels = useDataTableLabels();
  const errorMessage = useErrorMessage();
  const [pendingDelete, setPendingDelete] = useState<DemoUser | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState('');
  // Una sola instancia por montaje (los datos de ejemplo son deterministas).
  const [fetchUsers] = useState(() => createDemoFetcher());

  const table = useTableQuery<DemoUser>({
    queryKey: ['catalog', 'users'],
    fetchPage: fetchUsers,
    search,
    onSearchChange,
  });

  const columns = useMemo<Column<DemoUser>[]>(
    () => [
      { id: 'name', header: t('catalog.table.col.name'), cell: (row) => row.name, sortKey: 'name' },
      {
        id: 'platform',
        header: t('catalog.table.col.platform'),
        cell: (row) => row.platform,
        sortKey: 'platform',
      },
      {
        id: 'status',
        header: t('catalog.table.col.status'),
        cell: (row) => (
          <StatusBadge status={STATUS_TONE[row.status]} label={t(`status.${row.status}`)} />
        ),
        sortKey: 'status',
      },
      {
        id: 'id',
        header: t('catalog.table.col.id'),
        cell: (row) => <code className="font-mono text-text-secondary">{row.id}</code>,
      },
    ],
    [t],
  );

  return (
    <>
      <PageHeader title={t('catalog.title')} description={t('catalog.description')} />

      <Section title={t('catalog.section.buttons')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{t('catalog.button.primary')}</Button>
          <Button variant="secondary">{t('catalog.button.secondary')}</Button>
          <Button variant="ghost">{t('catalog.button.ghost')}</Button>
          <Button variant="danger">{t('catalog.button.danger')}</Button>
          <Button loading>{t('catalog.button.loading')}</Button>
          <Button disabled>{t('catalog.button.disabled')}</Button>
          <IconButton
            label={t('catalog.iconButton.label')}
            icon={<Settings className="size-4" />}
            variant="secondary"
          />
        </div>
      </Section>

      <Section title={t('catalog.section.badges')}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{t('catalog.badge.neutral')}</Badge>
          <Badge tone="accent">{t('catalog.badge.accent')}</Badge>
          {(Object.keys(STATUS_TONE) as DemoUser['status'][]).map((status) => (
            <StatusBadge key={status} status={STATUS_TONE[status]} label={t(`status.${status}`)} />
          ))}
        </div>
      </Section>

      <Section title={t('catalog.section.form')}>
        <FormField
          label={t('catalog.form.name.label')}
          help={t('catalog.form.name.help')}
          error={name.trim() === '' ? t('catalog.form.name.error') : undefined}
          required
          className="max-w-sm"
        >
          {(control) => (
            <Input
              {...control}
              invalid={control['aria-invalid'] === true}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
      </Section>

      <Section title={t('catalog.section.dialog')}>
        <div>
          <Button
            variant="danger"
            onClick={() => {
              setPendingDelete(null);
              setConfirmOpen(true);
            }}
          >
            {t('catalog.dialog.open')}
          </Button>
        </div>
      </Section>

      <Section title={t('catalog.section.table')}>
        <DataTable<DemoUser>
          caption={t('catalog.table.caption')}
          columns={columns}
          rows={table.rows}
          getRowId={(row) => row.id}
          status={table.status}
          sort={table.sort}
          onSortChange={table.onSortChange}
          limit={table.limit}
          onLimitChange={table.onLimitChange}
          pagination={table.pagination}
          refreshing={table.refreshing}
          hasActiveFilters={table.hasActiveFilters}
          onClearFilters={table.clearFilters}
          labels={labels}
          emptyState={
            <EmptyState title={t('table.empty.title')} description={t('table.empty.description')} />
          }
          errorState={{ message: errorMessage(table.error), onRetry: table.retry }}
          toolbar={
            <SearchInput
              className="max-w-sm"
              label={t('search.label')}
              clearLabel={t('search.clear')}
              placeholder={t('search.placeholder')}
              value={table.q}
              onValueChange={table.onQueryChange}
            />
          }
          rowActions={(row) => (
            <IconButton
              label={t('actions.delete')}
              icon={<Trash2 className="size-4" />}
              onClick={() => {
                setPendingDelete(row);
                setConfirmOpen(true);
              }}
            />
          )}
        />
      </Section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title={t('catalog.dialog.title')}
        description={
          pendingDelete === null
            ? t('catalog.dialog.description')
            : `${pendingDelete.name}. ${t('catalog.dialog.description')}`
        }
        confirmLabel={t('actions.delete')}
        cancelLabel={t('actions.cancel')}
        onConfirm={() => {
          setConfirmOpen(false);
        }}
      />
    </>
  );
}
