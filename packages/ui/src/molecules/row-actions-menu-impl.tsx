import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import { IconButton } from '../atoms/icon-button';
import { Ellipsis } from '../icons';
import { cn } from '../lib/cn';

import type { RowActionsMenuProps } from './row-actions-menu';

/**
 * Implementación del menú sobre Radix. Vive en su propio módulo para que `RowActionsMenu` la cargue
 * de forma diferida: Radix Dropdown trae Popper/Floating UI (~20 KB comprimidos) y, importado de
 * forma estática desde el barril de `@iam/ui`, terminaría en el JS inicial de toda la app.
 */
export function RowActionsMenuImpl({ label, items }: RowActionsMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton
          size="sm"
          label={label}
          icon={<Ellipsis aria-hidden="true" className="size-4" />}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-md border border-border-strong bg-overlay p-1 shadow-overlay"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              onSelect={item.onSelect}
              className={cn(
                'flex min-h-8 cursor-pointer select-none items-center rounded-sm px-3 text-sm outline-none',
                'data-[highlighted]:bg-raised data-[highlighted]:outline data-[highlighted]:outline-2 data-[highlighted]:outline-focus',
                item.tone === 'danger' ? 'text-danger' : 'text-text',
              )}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
