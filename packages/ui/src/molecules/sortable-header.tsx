import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { cn } from '../lib/cn';

export type SortDirection = 'asc' | 'desc';

export type SortableHeaderProps = {
  /** Texto del encabezado, ya traducido. */
  label: string;
  /** Dirección activa; `undefined` si la columna no está ordenada. */
  direction?: SortDirection | undefined;
  onToggle: () => void;
  align?: 'start' | 'end';
};

/**
 * Botón de encabezado ordenable. El estado (`aria-sort`) lo declara la celda `<th>` que lo
 * contiene (DataTable); aquí solo hay indicador visual y teclado nativo (Enter/Espacio).
 */
export function SortableHeader({
  label,
  direction,
  onToggle,
  align = 'start',
}: SortableHeaderProps) {
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        '-mx-2 inline-flex min-h-6 items-center gap-1 rounded-sm px-2 py-1 font-medium hover:bg-raised',
        align === 'end' && 'flex-row-reverse',
        direction === undefined ? 'text-text-secondary' : 'text-text',
      )}
    >
      {label}
      <Icon aria-hidden="true" className="size-4 shrink-0" />
    </button>
  );
}
