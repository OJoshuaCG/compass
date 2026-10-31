import { Link } from '@tanstack/react-router';

export type SectionPath = '/users' | '/roles' | '/security' | '/sessions';

export type SectionLink = { readonly to: SectionPath; /** Ya traducido. */ readonly label: string };

/**
 * Pestañas de una sección del menú (Personas, Configuración): cada una es una ruta propia, así
 * que son enlaces con `aria-current`, no el patrón `tablist` de `Tabs` (ese cambia paneles dentro
 * de una misma pantalla). Se dibujan pegadas a los bordes de la barra superior, como en el diseño.
 */
export function SectionNav({ label, links }: { label: string; links: readonly SectionLink[] }) {
  return (
    <nav aria-label={label} className="-my-3 flex min-w-0 self-stretch overflow-x-auto">
      <ul className="flex gap-1">
        {links.map((link) => (
          <li key={link.to} className="flex">
            <Link
              to={link.to}
              className="flex items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-fast"
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
