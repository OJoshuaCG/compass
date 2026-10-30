import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo, type ReactNode } from 'react';

import { Button } from '../atoms/button';
import { Skeleton } from '../atoms/skeleton';
import { cn } from '../lib/cn';
import { EmptyState } from '../molecules/empty-state';
import { Pagination, type PageLimit, type PaginationLabels } from '../molecules/pagination';
import { SortableHeader, type SortDirection } from '../molecules/sortable-header';

export type Column<T> = {
  id: string;
  /** Ya traducido por el container. */
  header: string;
  cell: (row: T) => ReactNode;
  /** Presente = columna ordenable (campo indexado que la API valida). */
  sortKey?: string;
  align?: 'start' | 'end';
};

export type TableSort = { key: string; dir: SortDirection };

export type DataTableLabels = {
  pagination: PaginationLabels;
  /** Texto de rango ("Mostrando 1–25 de 120"); `total` solo si la API lo entrega. */
  range: (range: { from: number; to: number; total?: number }) => string;
  /** Encabezado (solo para lectores de pantalla) de la columna de acciones. */
  actionsColumn: string;
  /** Anuncio mientras carga. */
  loading: string;
  retry: string;
  emptyFiltered: { title: string; description: string; clear: string };
};

export type DataTableProps<T extends object> = {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  status: 'loading' | 'success' | 'error';
  sort?: TableSort | undefined;
  onSortChange: (sort?: TableSort) => void;
  limit: PageLimit;
  onLimitChange: (limit: PageLimit) => void;
  pagination: {
    hasPrevious: boolean;
    hasNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
    total?: number | undefined;
    /** Filas anteriores a esta página (pila de cursores × límite); 0 en la primera. */
    offset?: number | undefined;
  };
  emptyState: ReactNode;
  errorState?: { message: string; onRetry: () => void } | undefined;
  rowActions?: ((row: T) => ReactNode) | undefined;
  /** Obligatoria: describe la tabla a los lectores de pantalla. */
  caption: string;
  labels: DataTableLabels;
  /** Hay filtros o búsqueda activos: un resultado vacío usa el estado "sin resultados". */
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  /** Hay una petición en curso conservando la página anterior (keepPreviousData). */
  refreshing?: boolean;
  /** Barra superior opcional (búsqueda, filtros, acciones). */
  toolbar?: ReactNode;
  className?: string;
};

// Solo el núcleo de TanStack Table: el orden y la paginación son del servidor (modo manual),
// así que no se registra ningún modelo de filas adicional.
const features = tableFeatures({});

/** Ciclo de orden: ascendente → descendente → sin orden. */
export function nextSort(current: TableSort | undefined, key: string): TableSort | undefined {
  if (current?.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : undefined;
}

const ariaSortValue = { asc: 'ascending', desc: 'descending' } as const;

/**
 * Tabla estándar de la aplicación (docs/frontend.md §6). Presentacional: no hace
 * peticiones; el orden, el límite y los cursores los controla el container (`useTableQuery`).
 * Teclado: encabezados ordenables y botones de pie son botones nativos (Tab, Enter, Espacio).
 */
export function DataTable<T extends object>({
  columns,
  rows,
  getRowId,
  status,
  sort,
  onSortChange,
  limit,
  onLimitChange,
  pagination,
  emptyState,
  errorState,
  rowActions,
  caption,
  labels,
  hasActiveFilters = false,
  onClearFilters,
  refreshing = false,
  toolbar,
  className,
}: DataTableProps<T>) {
  const tableColumns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    return columns.map((column) =>
      helper.display({
        id: column.id,
        header: column.header,
        cell: ({ row }) => column.cell(row.original),
      }),
    );
  }, [columns]);

  const table = useTable({ features, columns: tableColumns, data: rows, getRowId });
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const colSpan = columns.length + (rowActions ? 1 : 0);

  const offset = pagination.offset ?? 0;
  const hasRows = status === 'success' && rows.length > 0;
  const range = hasRows
    ? labels.range({
        from: offset + 1,
        to: offset + rows.length,
        ...(pagination.total !== undefined ? { total: pagination.total } : {}),
      })
    : '';
  const busy = status === 'loading' || refreshing;

  return (
    <div className={cn('rounded-lg border border-border-strong bg-surface', className)}>
      {toolbar !== undefined ? <div className="border-b border-border p-3">{toolbar}</div> : null}
      {/* Scroll horizontal contenido en la tabla, no en la página; enfocable para teclado. */}
      <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto">
        <table
          aria-busy={busy}
          className={cn('w-full text-sm tabular-nums', refreshing && 'opacity-70')}
        >
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-border-strong text-start text-text-secondary">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const column = columnById.get(header.column.id);
                  const sortKey = column?.sortKey;
                  const direction =
                    sortKey !== undefined && sort?.key === sortKey ? sort.dir : undefined;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sortKey === undefined
                          ? undefined
                          : direction
                            ? ariaSortValue[direction]
                            : 'none'
                      }
                      className={cn(
                        'px-4 py-2 font-medium',
                        column?.align === 'end' ? 'text-end' : 'text-start',
                      )}
                    >
                      {sortKey !== undefined ? (
                        <SortableHeader
                          label={column?.header ?? ''}
                          direction={direction}
                          align={column?.align ?? 'start'}
                          onToggle={() => {
                            onSortChange(nextSort(sort, sortKey));
                          }}
                        />
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  );
                })}
                {rowActions ? (
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">{labels.actionsColumn}</span>
                  </th>
                ) : null}
              </tr>
            ))}
          </thead>
          <tbody>
            {status === 'loading'
              ? Array.from({ length: Math.min(limit, 10) }, (_, index) => (
                  <tr key={index} className="border-b border-border last:border-b-0">
                    {Array.from({ length: colSpan }, (_, cellIndex) => (
                      <td key={cellIndex} className="px-4 py-3">
                        <Skeleton />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {status === 'error' ? (
              <tr>
                <td colSpan={colSpan}>
                  <div
                    role="alert"
                    className="flex flex-col items-center gap-3 px-4 py-10 text-center"
                  >
                    <p className="text-sm text-danger">{errorState?.message}</p>
                    {errorState ? (
                      <Button variant="secondary" size="sm" onClick={errorState.onRetry}>
                        {labels.retry}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : null}
            {status === 'success' && rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan}>
                  {hasActiveFilters ? (
                    <EmptyState
                      title={labels.emptyFiltered.title}
                      description={labels.emptyFiltered.description}
                      action={
                        onClearFilters ? (
                          <Button variant="secondary" size="sm" onClick={onClearFilters}>
                            {labels.emptyFiltered.clear}
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    emptyState
                  )}
                </td>
              </tr>
            ) : null}
            {status === 'success'
              ? table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-b-0 hover:bg-raised"
                  >
                    {row.getAllCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-4 py-3 text-text',
                          columnById.get(cell.column.id)?.align === 'end' && 'text-end',
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                    {rowActions ? (
                      <td className="px-4 py-3 text-end">{rowActions(row.original)}</td>
                    ) : null}
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border-strong p-3">
        <Pagination
          labels={labels.pagination}
          rangeText={range}
          limit={limit}
          onLimitChange={onLimitChange}
          hasPrevious={pagination.hasPrevious && status !== 'loading'}
          hasNext={pagination.hasNext && status !== 'loading' && !refreshing}
          onPrevious={pagination.onPrevious}
          onNext={pagination.onNext}
        />
      </div>
      {/* Anuncia cambios de página y de carga sin mover el foco. */}
      <div role="status" aria-live="polite" className="sr-only">
        {status === 'loading' ? labels.loading : range}
      </div>
    </div>
  );
}
