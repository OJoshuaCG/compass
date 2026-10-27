import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1).optional(),
  LOCAL_KMS_KEY_FILE: z.string().min(1).default('.local-kms/kek.key'),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Valida el entorno al arrancar: el servicio no inicia con configuración inválida.
 * El error lista las claves y el tipo de falla, jamás los valores (podrían ser secretos).
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = envSchema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues
    .map((issue) => `${issue.path.map(String).join('.')}: ${issue.code}`)
    .join(', ');
  throw new Error(`Invalid configuration: ${problems}`);
}
