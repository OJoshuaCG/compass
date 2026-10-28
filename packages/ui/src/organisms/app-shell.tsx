import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type AppShellProps = {
  /** Marca en la parte superior de la barra lateral. */
  brand?: ReactNode;
  /** Contenido de la barra lateral (normalmente un <nav> con enlaces). */
  sidebar: ReactNode;
  /** Pie de la barra lateral (persona en sesión, cierre de sesión). */
  sidebarFooter?: ReactNode;
  /** Barra superior del contenido (selector de idioma, acciones globales). */
  header: ReactNode;
  /** Texto del enlace "saltar al contenido", ya traducido. */
  skipLinkLabel: string;
  children: ReactNode;
  className?: string;
};

/** Identificador del `<main>`: destino del enlace de salto. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * Estructura base: enlace de salto, barra lateral azul marino (marca, navegación y pie),
 * barra superior clara y contenido principal con ancho máximo. En pantallas angostas la barra
 * lateral queda arriba. Los landmarks (`complementary`, `banner`, `main`) los aportan las etiquetas.
 */
export function AppShell({
  brand,
  sidebar,
  sidebarFooter,
  header,
  skipLinkLabel,
  children,
  className,
}: AppShellProps) {
  return (
    <div className={cn('flex min-h-screen flex-col bg-canvas text-text md:flex-row', className)}>
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-10 focus:rounded-md focus:bg-overlay focus:px-3 focus:py-2"
      >
        {skipLinkLabel}
      </a>
      {/* El foco por defecto (azul) no contrasta con el fondo marino: se usa el de navegación. */}
      <aside className="flex flex-col gap-6 bg-nav p-4 text-nav-text md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto [&_:focus-visible]:outline-nav-focus">
        {brand !== undefined ? <div className="px-2 py-1">{brand}</div> : null}
        {sidebar}
        {sidebarFooter !== undefined ? <div className="md:mt-auto">{sidebarFooter}</div> : null}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-border bg-surface px-4 py-3 md:px-6">
          {header}
        </header>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
