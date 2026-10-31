import { useId } from 'react';

export type PermissionCatalogItem = {
  id: string;
  /** Ya traducido. */
  label: string;
  /** Ya traducido: el rango más bajo que puede tener el permiso. */
  maxRankLabel: string;
};

export type PermissionCatalogGroup = {
  id: string;
  /** Ya traducido. */
  label: string;
  items: PermissionCatalogItem[];
};

export type PermissionCatalogProps = {
  groups: PermissionCatalogGroup[];
  emptyMessage: string;
};

/**
 * Catálogo de permisos de solo lectura, por área. Presentacional. Cada área es una sección con su
 * encabezado y una lista; el rango se escribe con texto (nunca solo con color o ícono).
 */
export function PermissionCatalog({ groups, emptyMessage }: PermissionCatalogProps) {
  const base = useId();
  if (groups.length === 0) return <p className="text-sm text-text-secondary">{emptyMessage}</p>;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`${base}-${group.id}`}>
          <h2 id={`${base}-${group.id}`} className="text-xs font-medium uppercase text-text-muted">
            {group.label}
          </h2>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {group.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
              >
                <span className="text-text">{item.label}</span>
                <span className="text-text-secondary">{item.maxRankLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
