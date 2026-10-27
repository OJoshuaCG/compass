import { SetMetadata } from '@nestjs/common';

import type { DomainError, Result } from '../kernel/index.js';

export const IS_PUBLIC = 'iam:public';
export const ALLOWS_PARTIAL_SESSION = 'iam:partial-session';

/** Ruta sin sesión (login, vista previa y aceptación de invitación). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * Ruta que acepta una sesión a medias (contraseña verificada, segundo factor pendiente): solo las
 * necesarias para completar el segundo factor y cerrar sesión.
 */
export const PartialSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOWS_PARTIAL_SESSION, true);

export const RATE_LIMITED = 'iam:rate-limited';

/** Aplica el límite por IP a todas las rutas de un controlador (autenticación, invitaciones). */
export const RateLimited = (): MethodDecorator & ClassDecorator => SetMetadata(RATE_LIMITED, true);

/** Convierte un `Result` de un caso de uso en valor o en la excepción que el filtro traduce. */
export function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}
