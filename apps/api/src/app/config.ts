import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1).optional(),
  LOCAL_KMS_KEY_FILE: z.string().min(1).default('.local-kms/kek.key'),
  /** Origen del navegador que usa la API (verificación de `Origin` contra CSRF y enlaces de correo). */
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  /** Carpeta de la SPA compilada; si se omite, la API no sirve el frontend (útil en desarrollo con Vite). */
  WEB_DIST_DIR: z.string().min(1).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Solo detrás de un balanceador de confianza: usa `X-Forwarded-For` para la IP del cliente. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
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
