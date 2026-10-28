import type { ReactNode } from 'react';

export type AuthCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

/** Marco común de las pantallas de acceso: un único `h1` y el contenido en una tarjeta. */
export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <section className="flex flex-col gap-6 rounded-lg bg-surface p-6 shadow-overlay sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl text-text">{title}</h1>
        {description !== undefined ? (
          <p className="text-sm text-text-secondary">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
