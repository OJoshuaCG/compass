import { z } from 'zod';

/** `scheduled`: rotación periódica; `incident`: sospecha de exposición (exige además a la Raíz). */
export const dataKeyRotationReasonSchema = z.enum(['scheduled', 'incident']);

export const rotateDataKeyRequestSchema = z.object({ reason: dataKeyRotationReasonSchema });
export type RotateDataKeyRequest = z.infer<typeof rotateDataKeyRequestSchema>;

/** Solo números de versión: nunca material de clave. */
export const dataKeyRotationSchema = z.object({
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
  reason: dataKeyRotationReasonSchema,
});
export type DataKeyRotation = z.infer<typeof dataKeyRotationSchema>;
