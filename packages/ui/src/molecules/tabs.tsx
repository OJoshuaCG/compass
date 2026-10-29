import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export type TabItem = { id: string; /** Ya traducido. */ label: string };

export type TabsProps = {
  /** Nombre accesible de la lista de pestañas (ya traducido). */
  label: string;
  tabs: readonly TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  /** Contenido del panel activo: el container monta solo el de la pestaña elegida. */
  children: ReactNode;
};

/**
 * Pestañas con el patrón WAI-ARIA (activación automática): ←/→ y Home/End mueven la selección y
 * el foco; solo la pestaña activa está en el orden de tabulación. `aria-controls` se pone solo en
 * la activa porque los paneles inactivos no existen en el DOM (un id inexistente sería inválido).
 */
export function Tabs({ label, tabs, value, onValueChange, children }: TabsProps) {
  const base = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === value);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabs[next];
    if (target === undefined) return;
    onValueChange(target.id);
    buttons.current.get(target.id)?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* El manejador va en la lista (delegación): las pestañas son botones nativos. */}
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 border-b border-border-strong"
      >
        {tabs.map((tab) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node === null) buttons.current.delete(tab.id);
                else buttons.current.set(tab.id, node);
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                onValueChange(tab.id);
              }}
              className={cn(
                'min-h-10 border-b-2 px-4 text-sm font-medium transition-colors duration-fast',
                selected
                  ? 'border-accent text-text'
                  : 'border-transparent text-text-secondary hover:text-text',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {/* `tabIndex={0}`: si el panel no tiene un elemento enfocable, el teclado no llegaría a su
          contenido (patrón WAI-ARIA de pestañas). */}
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(value)} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
