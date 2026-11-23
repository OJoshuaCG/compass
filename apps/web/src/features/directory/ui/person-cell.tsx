export type PersonCellProps = {
  displayName: string;
  /** Segunda línea opcional (el correo en la gestión del equipo). */
  email?: string;
};

/** Iniciales para el avatar: primera letra de las dos primeras palabras del nombre. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

/**
 * Persona con su avatar de iniciales, como el diseño de Compass. El avatar es decorativo
 * (`aria-hidden`): el nombre accesible sigue siendo solo el nombre (y el correo si lo hay).
 */
export function PersonCell({ displayName, email }: PersonCellProps) {
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-bold text-accent"
      >
        {initials(displayName)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold text-text">{displayName}</span>
        {email !== undefined ? <span className="text-text-muted">{email}</span> : null}
      </span>
    </span>
  );
}
