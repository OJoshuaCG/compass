/**
 * Las respuestas idempotentes se guardan 24 horas en claro en `idempotency_keys.response`. Una ruta que
 * devuelva un secreto (contraseña inicial, códigos de recuperación, secreto del segundo factor,
 * tokens, material de claves) jamás debe marcarse `@Idempotent()`: este control lo hace cumplir
 * aunque alguien lo olvide, negándose a guardar la respuesta (TODO A4).
 */
const SECRET_KEY_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'recovery',
  'emergency',
  'codes',
  'privatekey',
  'dek',
  'kek',
  'passphrase',
  'credential',
  'apikey',
  'otp',
  'seed',
  'mnemonic',
] as const;

const MAX_DEPTH = 8;

function looksLikeSecretKey(key: string): boolean {
  // Sin separadores: `private_key`, `private-key` y `privateKey` son el mismo nombre.
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  return SECRET_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/** `true` si algún nombre de campo, a cualquier profundidad razonable, sugiere un secreto. */
export function carriesSecretField(value: unknown, depth = 0): boolean {
  // Más allá del límite no se puede afirmar que sea seguro: se trata como si llevara un secreto.
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) {
    return value.some((item) => carriesSecretField(item, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).some(
      ([key, nested]) => looksLikeSecretKey(key) || carriesSecretField(nested, depth + 1),
    );
  }
  return false;
}
