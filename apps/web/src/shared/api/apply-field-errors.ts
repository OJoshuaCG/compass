import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ApiError } from './api-error';

/**
 * Mapea los errores por campo de un 422 (`errors[]` de Problem Details) a `setError` del
 * formulario (docs/frontend.md §7.2 y §8). Solo se aplican los campos que el formulario conoce;
 * los demás se ignoran. Devuelve `true` si colocó al menos un error, para que el llamador
 * muestre el aviso general solo cuando no hubo campo al que atribuirlo.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly Path<T>[],
  message: string,
): boolean {
  if (!(error instanceof ApiError) || error.status !== 422) return false;
  let applied = false;
  for (const fieldError of error.fieldErrors) {
    const field = knownFields.find((known) => known === fieldError.field);
    if (field === undefined) continue;
    setError(field, { type: 'server', message });
    applied = true;
  }
  return applied;
}
