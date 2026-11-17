import zxcvbn from 'zxcvbn';

import type {
  PasswordStrengthScore,
  PasswordStrengthScorer,
} from '../application/ports/password-strength-scorer.js';

/**
 * `zxcvbn` tarda cada vez más con textos largos (su propia documentación recomienda recortarlos). Una contraseña
 * más larga que el tope se valora por sus primeros caracteres: a esa longitud ya no es adivinable por fuerza
 * bruta, así que el recorte no suaviza el resultado de forma que importe.
 */
const MAX_SCORED_PASSWORD_LENGTH = 100;

/** Valora con `zxcvbn` (puntaje de 0 a 4). No se reimplementa el estimador. */
export class ZxcvbnPasswordStrengthScorer implements PasswordStrengthScorer {
  score(password: string): PasswordStrengthScore {
    const scoredText = password.slice(0, MAX_SCORED_PASSWORD_LENGTH);
    return zxcvbn(scoredText).score;
  }
}
