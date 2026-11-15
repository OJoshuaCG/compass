/**
 * Valora qué tan fácil es adivinar una contraseña (salud de credenciales, docs/business/governance.md §3).
 * Va detrás de un puerto para que el caso de uso no conozca la librería. La contraseña solo vive dentro de la
 * llamada: quien llama obtiene el texto del cifrado y solo guarda el puntaje, nunca el texto.
 */
export const PASSWORD_STRENGTH_MIN_SCORE = 0;
export const PASSWORD_STRENGTH_MAX_SCORE = 4;

/** 0 = trivial de adivinar, 4 = muy difícil de adivinar. */
export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrengthScorer {
  score(password: string): PasswordStrengthScore;
}
