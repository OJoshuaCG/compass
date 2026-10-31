import { ErrorCode } from '@iam/contracts';

import { DomainError } from '../../../shared/kernel/index.js';
import type { PasswordProblem } from '../domain/password-policy.js';

/**
 * Cada causa de rechazo tiene su propio código para que la persona sepa qué corregir. Solo se expone la
 * categoría: nunca qué dato personal coincidió ni la contraseña, y el mensaje no varía con la entrada.
 */
const PASSWORD_PROBLEM_CODES: Readonly<Record<PasswordProblem, ErrorCode>> = {
  TOO_SHORT: ErrorCode.PASSWORD_TOO_SHORT,
  TOO_LONG: ErrorCode.PASSWORD_TOO_LONG,
  TOO_WEAK: ErrorCode.PASSWORD_WEAK,
  CONTAINS_PERSONAL_DATA: ErrorCode.PASSWORD_CONTAINS_PERSONAL_DATA,
};

export function passwordProblemToError(problem: PasswordProblem): DomainError {
  return new DomainError(PASSWORD_PROBLEM_CODES[problem], 'Password rejected by the policy');
}
