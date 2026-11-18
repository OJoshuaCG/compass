import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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
  /** Rótulo de la barra de orden que se ve en móvil («Ordenar por»). */
  sortBy: string;
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

  // La región solo es enfocable cuando de verdad se desplaza en horizontal (WCAG 2.1.1): en móvil
  // la tabla son tarjetas apiladas y en escritorio puede caber entera, y ahí un tabulador extra
  // sobre la región no lleva a nada.
  const regionRef = useRef<HTMLDivElement>(null);
  const [scrollsHorizontally, setScrollsHorizontally] = useState(false);
  useEffect(() => {
    const region = regionRef.current;
    if (region === null || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      setScrollsHorizontally(region.scrollWidth > region.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    if (region.firstElementChild !== null) observer.observe(region.firstElementChild);
    return () => {
      observer.disconnect();
    };
  }, []);
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const colSpan = columns.length + (rowActions ? 1 : 0);
  const hasSortableColumns = columns.some((column) => column.sortKey !== undefined);

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
      {/* Scroll horizontal contenido en la tabla, no en la página; enfocable para teclado solo si se desplaza. */}
      <div
        ref={regionRef}
        role="region"
        aria-label={caption}
        tabIndex={scrollsHorizontally ? 0 : undefined}
        // `relative`: el texto `sr-only` de los encabezados es `position:absolute`; sin un ancestro
        // posicionado escapa del recorte del scroll y ensancha la página (visto a 768 px).
        className="relative overflow-x-auto rounded-t-lg"
      >
        <table
          aria-busy={busy}
          role="table"
          className={cn('w-full text-sm tabular-nums max-md:block', refreshing && 'opacity-70')}
        >
          <caption className="sr-only">{caption}</caption>
          {/* text-xs (12 px) en lugar de los 11 px del diseño: queda en la escala del proyecto y
            text-muted cumple contraste sobre raised (§4.2). */}
          {/* En móvil (max-md) cada fila es una tarjeta apilada (§6.2 «Móvil»): al pasar los elementos
            de la tabla a `display:block` algunos lectores de pantalla pierden la semántica de tabla,
            por eso se declaran los roles de forma explícita. */}
          <thead
            role="rowgroup"
            className={cn(
              'border-b border-border bg-raised text-start font-mono text-xs tracking-widest text-text-muted uppercase max-md:block',
              // Sin columnas ordenables la barra de orden sería una franja vacía en móvil; los
              // encabezados siguen disponibles para lectores de pantalla.
              !hasSortableColumns && 'max-md:sr-only',
            )}
          >
            {table.getHeaderGroups().map((group) => (
              <tr
                key={group.id}
                role="row"
                className="max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-4"
              >
                {/* Solo se ve en móvil: nombra la barra de orden. Es decorativo porque cada botón de
                    orden ya tiene su propio nombre accesible. */}
                <td role="presentation" aria-hidden="true" className="hidden px-4 max-md:block">
                  {labels.sortBy}
                </td>
                {group.headers.map((header) => {
                  const column = columnById.get(header.column.id);
                  const sortKey = column?.sortKey;
                  const direction =
                    sortKey !== undefined && sort?.key === sortKey ? sort.dir : undefined;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      role="columnheader"
                      aria-sort={
                        sortKey === undefined
                          ? undefined
                          : direction
                            ? ariaSortValue[direction]
                            : 'none'
                      }
                      className={cn(
                        'px-5 py-3 font-medium',
                        column?.align === 'end' ? 'text-end' : 'text-start',
                        // En móvil solo las columnas ordenables quedan visibles (barra de orden);
                        // las demás siguen disponibles para lectores de pantalla.
                        sortKey === undefined ? 'max-md:sr-only' : 'max-md:px-4',
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
                  <th scope="col" role="columnheader" className="px-5 py-3 max-md:sr-only">
                    <span className="sr-only">{labels.actionsColumn}</span>
                  </th>
                ) : null}
              </tr>
            ))}
          </thead>
          <tbody role="rowgroup" className="max-md:block">
            {status === 'loading'
              ? Array.from({ length: Math.min(limit, 10) }, (_, index) => (
                  <tr
                    key={index}
                    role="row"
                    className="border-b border-border last:border-b-0 max-md:block max-md:px-4 max-md:py-3"
                  >
                    {Array.from({ length: colSpan }, (_, cellIndex) => (
                      <td
                        key={cellIndex}
                        role="cell"
                        className="px-5 py-3.5 max-md:block max-md:px-4 max-md:py-1.5"
                      >
                        <Skeleton />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {status === 'error' ? (
              <tr role="row" className="max-md:block">
                <td colSpan={colSpan} role="cell" className="max-md:block">
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
              <tr role="row" className="max-md:block">
                <td colSpan={colSpan} role="cell" className="max-md:block">
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
                    role="row"
                    className="border-b border-border last:border-b-0 hover:bg-raised max-md:block max-md:px-4 max-md:py-3"
                  >
                    {row.getAllCells().map((cell) => (
                      <td
                        key={cell.id}
                        role="cell"
                        data-label={columnById.get(cell.column.id)?.header}
                        // `content-[attr(data-label)]` es un valor arbitrario inevitable: Tailwind
                        // no tiene utilidad semántica para `attr()`. Pinta la etiqueta de la
                        // columna en móvil sin duplicar el DOM (§4.1, regla 8).
                        className={cn(
                          // `wrap-anywhere` y no `break-words`: en un contenedor flex solo el primero
                          // reduce el ancho mínimo, así los valores largos (hashes, correos) se parten.
                          'px-5 py-3.5 text-text wrap-anywhere max-md:min-w-0',
                          columnById.get(cell.column.id)?.align === 'end' && 'text-end',
                          'max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-4 max-md:px-4 max-md:py-1.5 max-md:text-end',
                          'max-md:before:shrink-0 max-md:before:content-[attr(data-label)] max-md:before:text-start max-md:before:font-mono max-md:before:text-xs max-md:before:text-text-muted max-md:before:uppercase',
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                    {rowActions ? (
                      <td
                        role="cell"
                        className="px-5 py-3.5 text-end max-md:flex max-md:justify-end max-md:border-t max-md:border-border max-md:px-4 max-md:py-2"
                      >
                        {rowActions(row.original)}
                      </td>
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
