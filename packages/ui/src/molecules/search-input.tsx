import { Search, X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Input } from '../atoms/input';
import { cn } from '../lib/cn';

export type SearchInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'aria-label'
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Nombre accesible del campo (ya traducido). */
  label: string;
  /** Nombre accesible del botón de borrado (ya traducido). */
  clearLabel: string;
};

/** Campo de búsqueda controlado. El debounce y la URL son responsabilidad del container. */
export function SearchInput({
  value,
  onValueChange,
  label,
  clearLabel,
  className,
  ...rest
}: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-3 size-4 text-text-muted"
      />
      <Input
        type="search"
        aria-label={label}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        // Variante arbitraria justificada: oculta el botón de borrado nativo de WebKit,
        // que duplicaría al botón propio (accesible y traducido).
        className="ps-9 pe-9 [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {value !== '' ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => {
            onValueChange('');
          }}
          className="absolute end-1 top-1 inline-flex size-8 items-center justify-center rounded-sm text-text-secondary hover:bg-raised hover:text-text"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
