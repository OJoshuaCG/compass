import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type AppShellProps = {
  /** Contenido de la barra lateral (normalmente un <nav> con enlaces). */
  sidebar: ReactNode;
  /** Contenido de la cabecera (marca, selector de idioma, menú de usuario). */
  header: ReactNode;
  /** Texto del enlace "saltar al contenido", ya traducido. */
  skipLinkLabel: string;
  children: ReactNode;
  className?: string;
};

/** Identificador del `<main>`: destino del enlace de salto. */
export const MAIN_CONTENT_ID = 'main-content';

/** Clase del `<main>` enfocable por código: el foco programático no debe dibujar un contorno. */
export const MAIN_CONTENT_CLASS = 'outline-none';

/** Enlace de salto al `<main>`: solo visible al recibir foco (WCAG 2.4.1). */
export function SkipLink({ label }: { label: string }) {
  return (
    // z-50 por encima de la barra superior fija (z-30), que de otro modo taparía el enlace.
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-overlay focus:px-3 focus:py-2"
    >
      {label}
    </a>
  );
}

/**
 * Estructura base (docs/frontend.md §4.1): enlace de salto, barra superior fija de cristal,
 * menú lateral y contenido principal con ancho máximo. Los landmarks (`banner`,
 * `complementary`, `main`) los aportan las etiquetas.
 */
export function AppShell({ sidebar, header, skipLinkLabel, children, className }: AppShellProps) {
  return (
    <div className={cn('flex min-h-screen flex-col text-text', className)}>
      <SkipLink label={skipLinkLabel} />
      <header className="glass-bar sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2 md:px-5">
        {header}
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        {/* w-62 = 248 px, el ancho del menú del diseño (ADR 0044): cabe la etiqueta más larga
            («Alertas de infraestructura») sin cortarla. En pantallas estrechas ocupa todo el ancho. */}
        <aside className="border-b border-border bg-sidebar px-3 pt-4 pb-6 md:w-62 md:shrink-0 md:border-e md:border-b-0">
          {sidebar}
        </aside>
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className={cn(MAIN_CONTENT_CLASS, 'min-w-0 flex-1 px-4 py-8 md:px-10 md:py-10')}
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-7">{children}</div>
        </main>
      </div>
    </div>
  );
}
