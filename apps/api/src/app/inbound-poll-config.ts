import { z } from 'zod';

/**
 * Configuración propia del worker de correo entrante (ADR 0045). No usa `loadConfig`: aquel exige la
 * configuración completa de la API (origen web, SMTP, WebAuthn...), y este proceso debe arrancar solo con
 * su identidad de base de datos y el KMS. Así el rol `iam_inbound_worker` no comparte variables con la API.
 */
const PRODUCTION_KMS_ADAPTERS: readonly string[] = ['aws'];

const envSchema = z
  .object({
    /** Obligatorio, sin valor por defecto: un archivo de entorno sin él no debe poder abrir la KEK local por omisión. */
    NODE_ENV: z.enum(['development', 'test', 'production']),
    /** Conexión con el rol `iam_inbound_worker` (nunca la de la aplicación ni la de migraciones). */
    DATABASE_URL_INBOUND_WORKER: z.string().min(1),
    KMS_ADAPTER: z.enum(['local', 'aws']).default('local'),
    AWS_KMS_KEY_ID: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).optional(),
    LOCAL_KMS_KEY_FILE: z.string().min(1).default('.local-kms/kek.key'),
    /**
     * Redes privadas que el servidor de correo de una fuente puede ocupar (IP o CIDR separados por coma). Vacío
     * por defecto: solo se conectan direcciones públicas. Cada entrada se valida en `NetworkGuard`.
     */
    INBOUND_POLL_ALLOWED_PRIVATE_NETWORKS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== ''),
      ),
    /** Tope de fuentes por pasada: acota el tiempo de una pasada que el cron repite cada minuto. */
    INBOUND_POLL_MAX_SOURCES_PER_RUN: z.coerce.number().int().min(1).max(500).default(50),
    /** Tiempo total tras el cual no se empieza otra fuente. Debe quedar por debajo del periodo del cron. */
    INBOUND_POLL_RUN_BUDGET_SECONDS: z.coerce.number().int().min(10).max(3600).default(50),
  })
  .superRefine((env, ctx) => {
    if (env.KMS_ADAPTER === 'aws') {
      for (const key of ['AWS_KMS_KEY_ID', 'AWS_REGION'] as const) {
        if (env[key] === undefined)
          ctx.addIssue({ code: 'custom', path: [key], message: 'required' });
      }
    }
    if (env.NODE_ENV === 'production' && !PRODUCTION_KMS_ADAPTERS.includes(env.KMS_ADAPTER)) {
      ctx.addIssue({
        code: 'custom',
        path: ['KMS_ADAPTER'],
        message: 'the local key management is not allowed in production',
      });
    }
  });

export type InboundPollConfig = z.infer<typeof envSchema>;

/** Igual que `loadConfig`: el error nombra claves y tipo de falla, jamás valores (podrían ser secretos). */
export function loadInboundPollConfig(
  env: Readonly<Record<string, string | undefined>>,
): InboundPollConfig {
  const result = envSchema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues
    .map((issue) => `${issue.path.map(String).join('.')}: ${issue.code}`)
    .join(', ');
  throw new Error(`Invalid configuration: ${problems}`);
}
