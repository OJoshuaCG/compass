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
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-10 focus:rounded-md focus:bg-overlay focus:px-3 focus:py-2"
    >
      {label}
    </a>
  );
}

/**
 * Estructura base: enlace de salto, cabecera, barra lateral y contenido principal con
 * ancho máximo. Los landmarks (`banner`, `complementary`, `main`) los aportan las etiquetas.
 */
export function AppShell({ sidebar, header, skipLinkLabel, children, className }: AppShellProps) {
  return (
    <div className={cn('flex min-h-screen flex-col bg-canvas text-text', className)}>
      <SkipLink label={skipLinkLabel} />
      <header className="flex items-center justify-between gap-4 border-b border-border-strong bg-surface px-4 py-3">
        {header}
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-border-strong bg-surface p-3 md:w-64 md:shrink-0 md:border-e md:border-b-0">
          {sidebar}
        </aside>
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className={cn(MAIN_CONTENT_CLASS, 'min-w-0 flex-1 p-4 md:p-6')}
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
