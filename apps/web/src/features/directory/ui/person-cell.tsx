import { Avatar } from '@iam/ui';

export type PersonCellProps = {
  displayName: string;
};

/**
 * Celda de persona del directorio: avatar con iniciales y nombre. El avatar es decorativo
 * (`aria-hidden`), así que el nombre accesible de la celda sigue siendo solo el nombre.
 */
export function PersonCell({ displayName }: PersonCellProps) {
  return (
    <span className="flex items-center gap-3">
      <Avatar name={displayName} />
      <span className="font-medium text-text">{displayName}</span>
    </span>
  );
}
