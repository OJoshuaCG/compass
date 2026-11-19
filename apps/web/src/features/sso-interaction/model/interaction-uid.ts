const MAX_UID_LENGTH = 128;
const UID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * El `uid` lo genera el proveedor OIDC y viaja en la URL. Antes de usarlo para armar una ruta
 * de página completa (`/oidc/interaction/<uid>`) se exige el alfabeto base64url y un largo
 * acotado: así nunca puede colar `/`, `..`, `?` ni `#` y redirigir a otra ruta.
 */
export function isValidInteractionUid(value: string | undefined): value is string {
  return value !== undefined && value.length <= MAX_UID_LENGTH && UID_PATTERN.test(value);
}
