import type { ReactNode } from 'react';

export type AuthCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

/**
 * Marco común de las pantallas de acceso: un único `h1` centrado y el contenido directo sobre el
 * fondo azul marino (diseño de Compass), sin tarjeta.
 */
export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl text-text">{title}</h1>
        {description !== undefined ? (
          <p className="text-sm text-text-secondary">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
