import { Card } from '@iam/ui';
import { useEffect, useRef, type ReactNode } from 'react';

export type SsoCardProps = {
  title: string;
  description?: string;
  /** Mueve el foco al título al montarse: para estados que reemplazan la pantalla entera. */
  focusTitle?: boolean;
  children?: ReactNode;
};

/**
 * Marco de las pantallas del flujo SSO (misma forma que `AuthCard` de `features/auth`, que no se
 * puede importar entre features): un único `h1` y el contenido en una tarjeta opaca.
 */
export function SsoCard({ title, description, focusTitle = false, children }: SsoCardProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Un cambio de estado (cargado, vencido, error) no recarga la página: sin mover el foco,
    // quien usa teclado o lector de pantalla se quedaría en un elemento que ya no existe.
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle]);

  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-2">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="text-2xl font-semibold break-words text-text focus:outline-none"
        >
          {title}
        </h1>
        {description !== undefined ? (
          <p className="text-sm text-text-secondary">{description}</p>
        ) : null}
      </header>
      {children}
    </Card>
  );
}
