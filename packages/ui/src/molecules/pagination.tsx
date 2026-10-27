import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId } from 'react';

import { Button } from '../atoms/button';
import { NativeSelect } from '../atoms/native-select';
import { cn } from '../lib/cn';

export const PAGE_LIMIT_OPTIONS = [10, 25, 50, 100] as const;
export type PageLimit = (typeof PAGE_LIMIT_OPTIONS)[number];

export type PaginationLabels = {
  /** Nombre accesible de la región de paginación. */
  navigation: string;
  previous: string;
  next: string;
  rowsPerPage: string;
};

export type PaginationProps = {
  labels: PaginationLabels;
  /** Texto de rango ya traducido ("Mostrando 1–25"). */
  rangeText: string;
  limit: PageLimit;
  onLimitChange: (limit: PageLimit) => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
};

function isPageLimit(value: number): value is PageLimit {
  return (PAGE_LIMIT_OPTIONS as readonly number[]).includes(value);
}

/**
 * Pie de paginación por cursor: rango, filas por página y Anterior/Siguiente.
 * No hay números de página ni salto a la página N (docs/frontend.md §6.2).
 */
export function Pagination({
  labels,
  rangeText,
  limit,
  onLimitChange,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  className,
}: PaginationProps) {
  const selectId = useId();
  return (
    <nav
      aria-label={labels.navigation}
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary',
        className,
      )}
    >
      <p>{rangeText}</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor={selectId}>{labels.rowsPerPage}</label>
          <NativeSelect
            id={selectId}
            size="sm"
            value={limit}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (isPageLimit(next)) onLimitChange(next);
            }}
          >
            {PAGE_LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={!hasPrevious} onClick={onPrevious}>
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {labels.previous}
          </Button>
          <Button variant="secondary" size="sm" disabled={!hasNext} onClick={onNext}>
            {labels.next}
            <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
