/**
 * Política de contraseñas (plan: "Factores > Contraseña", NIST SP 800-63B): mínimo 12 caracteres,
 * SIN reglas de composición, rechazo de contraseñas comunes (diccionario local) y puntaje de
 * fortaleza mínimo. Además, no puede contener datos de la propia persona.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024;
export const PASSWORD_MIN_SCORE = 3;

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'TOO_WEAK' | 'CONTAINS_PERSONAL_DATA';

/** Fragmentos de 4 o más letras del correo y del nombre, en minúsculas. */
export function personalTokens(email: string, displayName: string): string[] {
  const local = email.split('@')[0] ?? '';
  return [local, ...local.split(/[^a-z0-9]+/i), ...displayName.split(/\s+/)]
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 4);
}

export function evaluatePassword(input: {
  readonly password: string;
  readonly score: number;
  readonly personalTokens: readonly string[];
}): PasswordProblem | null {
  // Se cuentan puntos de código, no unidades UTF-16: un emoji cuenta como un carácter.
  const length = Array.from(input.password).length;
  if (length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  const lowered = input.password.toLowerCase();
  if (input.personalTokens.some((token) => lowered.includes(token))) {
    return 'CONTAINS_PERSONAL_DATA';
  }
  if (input.score < PASSWORD_MIN_SCORE) return 'TOO_WEAK';
  return null;
}
