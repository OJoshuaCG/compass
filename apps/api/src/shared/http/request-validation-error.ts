import type { FieldError } from '@iam/contracts';

/** Entrada que no cumple su esquema Zod; el filtro global la traduce a `422`. */
export class RequestValidationError extends Error {
  constructor(readonly errors: readonly FieldError[]) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
  }
}
