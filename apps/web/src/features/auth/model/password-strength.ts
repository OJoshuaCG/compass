export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

/** Longitud mínima que exige el contrato (`acceptInvitationRequestSchema`). */
export const MIN_PASSWORD_LENGTH = 12;

/** Contraseñas comunes que un atacante prueba primero (comparación sin dígitos ni mayúsculas). */
const COMMON = new Set([
  'password',
  'contrasena',
  'contraseña',
  'qwerty',
  'qwertyuiop',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'abcdef',
  'changeme',
  'bienvenido',
  'mexico',
  'secreto',
  'passw0rd',
]);

function isRun(password: string): boolean {
  // Cadenas como "abcdefghijkl" o "123456789012": cada carácter es el anterior ±1.
  if (password.length < 6) return false;
  let steps = 0;
  for (let i = 1; i < password.length; i += 1) {
    const delta = password.charCodeAt(i) - password.charCodeAt(i - 1);
    if (Math.abs(delta) === 1) steps += 1;
  }
  return steps >= (password.length - 1) * 0.8;
}

/**
 * Estimación de fortaleza PURA y local (0 a 4), solo orientativa: el servidor es quien decide
 * (lista de comunes y zxcvbn). Corre en el navegador y nunca envía la contraseña a un tercero.
 * No impone reglas de composición (NIST SP 800-63B): la longitud pesa más que los símbolos.
 */
export function estimatePasswordStrength(password: string): PasswordStrength {
  if (password === '') return 0;
  const folded = password.toLowerCase().replace(/[\d\W_]+$/u, '');
  if (COMMON.has(folded) || COMMON.has(password.toLowerCase())) return 0;

  let score: number;
  if (password.length < 8) score = 0;
  else if (password.length < MIN_PASSWORD_LENGTH) score = 1;
  else if (password.length < 16) score = 2;
  else if (password.length < 20) score = 3;
  else score = 4;

  const unique = new Set(password).size;
  if (unique <= password.length / 3) score -= 2;
  if (isRun(password)) score -= 2;

  // Una contraseña corta nunca pasa de "débil": no cumple el mínimo del contrato.
  if (password.length < MIN_PASSWORD_LENGTH) score = Math.min(score, 1);
  return Math.max(0, Math.min(4, score)) as PasswordStrength;
}
