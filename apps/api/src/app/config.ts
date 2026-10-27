import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
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
    /** `log` escribe el enlace en el registro (solo desarrollo); `smtp` envía por el correo del dominio propio. */
    MAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURITY: z.enum(['starttls', 'tls', 'none']).default('starttls'),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM: z.string().min(3).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'smtp') {
      for (const key of ['SMTP_HOST', 'MAIL_FROM'] as const) {
        if (env[key] === undefined)
          ctx.addIssue({ code: 'custom', path: [key], message: 'required' });
      }
      if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_USER'],
          message: 'user and password go together',
        });
      }
    }
    if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT !== 'smtp') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'smtp is required in production',
      });
    }
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
