import { Link } from '@tanstack/react-router';

export type SectionPath =
  | '/users'
  | '/roles'
  | '/security'
  | '/sessions'
  | '/audit'
  | '/alerts'
  | '/inbound'
  | '/inbound/sources'
  | '/inbound/view-settings';

export type SectionLink = {
  readonly to: SectionPath;
  /** Ya traducido. */
  readonly label: string;
  /** Solo se marca en su ruta exacta: `/inbound` no debe quedar activo dentro de `/inbound/sources`. */
  readonly exact?: boolean;
};

/**
 * Pestañas de una sección del menú (Personas, Configuración): cada una es una ruta propia, así
 * que son enlaces con `aria-current`, no el patrón `tablist` de `Tabs` (ese cambia paneles dentro
 * de una misma pantalla). Van sobre el contenido, con la línea de la pestaña activa en el acento.
 */
export function SectionNav({ label, links }: { label: string; links: readonly SectionLink[] }) {
  return (
    <nav aria-label={label} className="flex min-w-0 overflow-x-auto border-b border-border">
      <ul className="flex gap-1">
        {links.map((link) => (
          <li key={link.to} className="flex">
            <Link
              to={link.to}
              activeOptions={{ exact: link.exact === true }}
              className="-mb-px flex min-h-10 items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-fast"
              activeProps={{ 'aria-current': 'page', className: 'border-accent text-text' }}
              inactiveProps={{
                className: 'border-transparent text-text-secondary hover:text-text',
              }}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
