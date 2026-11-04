import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import { cn } from '../lib/cn';

import type { UserMenuProps } from './user-menu';
import { USER_MENU_TRIGGER_CLASS } from './user-menu-styles';
import { UserMenuTriggerContent } from './user-menu-trigger-content';

/** Implementación sobre Radix; vive aparte para la carga diferida (ver `user-menu.tsx`). */
export function UserMenuImpl({ name, details, actions }: UserMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={USER_MENU_TRIGGER_CLASS}>
        <UserMenuTriggerContent name={name} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-56 glass rounded-md p-1"
        >
          <DropdownMenu.Label className="flex flex-col items-start gap-1.5 px-3 py-2">
            <span className="text-sm font-medium break-words text-text">{name}</span>
            {details}
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {actions.map((action) => (
            <DropdownMenu.Item
              key={action.id}
              disabled={action.pending === true}
              aria-busy={action.pending === true ? 'true' : undefined}
              onSelect={action.onSelect}
              className={cn(
                'flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-sm px-3 text-sm text-text outline-none',
                'data-[highlighted]:bg-raised data-[highlighted]:outline data-[highlighted]:outline-2 data-[highlighted]:outline-focus',
                'data-[disabled]:cursor-not-allowed data-[disabled]:text-text-disabled',
              )}
            >
              {action.icon !== undefined ? (
                <span aria-hidden="true" className="inline-flex">
                  {action.icon}
                </span>
              ) : null}
              {action.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
