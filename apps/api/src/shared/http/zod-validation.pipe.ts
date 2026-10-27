import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

import { RequestValidationError } from './request-validation-error.js';

/**
 * Valida con los esquemas Zod de `@iam/contracts` (una sola definición por contrato).
 * Reporta solo el campo y el tipo de falla, nunca el valor recibido (podría ser un secreto).
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || '(root)',
        code: issue.code,
      })),
    );
  }
}
