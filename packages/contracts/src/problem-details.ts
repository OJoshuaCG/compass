import { z } from 'zod';

import { ERROR_CODES } from './error-codes.js';

/** Campo inválido en una respuesta `422`. */
export const fieldErrorSchema = z.object({
  field: z.string().min(1),
  code: z.string().min(1),
});

/**
 * Cuerpo de error de la API (RFC 9457, Problem Details).
 * Nunca incluye detalles internos (SQL, rutas, trazas): solo `code` estable y `requestId`.
 */
export const problemDetailsSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  code: z.enum(ERROR_CODES as [string, ...string[]]),
  requestId: z.string().min(1),
  errors: z.array(fieldErrorSchema).optional(),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
