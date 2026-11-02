import { z } from 'zod';

import { emailSchema, safeText } from './text.js';

/** Mismo formato que la restricción de `organizations.slug` en la base de datos. */
const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * Alta de la primera organización y de su Raíz desde el enlace único (ADR 0046). El token es el
 * valor de `FIRST_SETUP_TOKEN`; el navegador lo toma del fragmento de la URL y lo envía aquí.
 * La política de contraseña (fortaleza, datos personales) la valida el servidor.
 */
export const firstSetupRequestSchema = z.object({
  token: z.string().min(32).max(200),
  organizationName: safeText({ max: 200, min: 1 }),
  organizationSlug: z.string().regex(ORGANIZATION_SLUG_PATTERN),
  rootEmail: emailSchema,
  rootDisplayName: safeText({ max: 200, min: 1 }),
  password: z.string().min(12).max(1024),
});
export type FirstSetupRequest = z.infer<typeof firstSetupRequestSchema>;

/** Custodio de cada código de emergencia (ADR 0037): dos personas distintas, fuera del sistema. */
export const emergencyCodeCustodySchema = z.enum(['A', 'B']);

/**
 * Los códigos de emergencia se entregan UNA sola vez: la respuesta no se guarda en ningún lado y
 * esta ruta nunca es idempotente, porque repetirla devolvería los códigos de nuevo.
 */
export const firstSetupResponseSchema = z.object({
  organizationId: z.uuid(),
  emergencyCodes: z.array(
    z.object({
      code: z.string().min(8),
      custodyGroup: emergencyCodeCustodySchema,
    }),
  ),
});
export type FirstSetupResponse = z.infer<typeof firstSetupResponseSchema>;
