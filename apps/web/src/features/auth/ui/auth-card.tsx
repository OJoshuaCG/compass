import { Card } from '@iam/ui';
import type { ReactNode } from 'react';

export type AuthCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

/** Marco común de las pantallas de acceso: un único `h1` y el contenido en una tarjeta opaca. */
export function AuthCard({ title, description, children }: AuthCardProps) {
  // Tarjeta opaca y no cristal: aquí se teclean contraseñas y códigos, el contenido debe leerse
  // sin fondo translúcido (docs/frontend.md §4.1, regla 2).
  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">{title}</h1>
        {description !== undefined ? (
          <p className="text-sm text-text-secondary">{description}</p>
        ) : null}
      </header>
      {children}
    </Card>
  );
}
