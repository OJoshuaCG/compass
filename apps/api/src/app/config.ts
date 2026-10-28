import { z } from 'zod';

import { parseTrustProxy } from './trust-proxy.js';
import type { TrustProxySetting } from './trust-proxy.js';

/** Adaptadores de gestión de claves aptos para producción: solo el KMS gestionado (ADR 0020). */
const PRODUCTION_KMS_ADAPTERS: readonly string[] = ['aws'];

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
    /** Adaptador de gestión de claves: `local` (archivo en disco, solo desarrollo) o `aws` (AWS KMS). */
    KMS_ADAPTER: z.enum(['local', 'aws']).default('local'),
    /** Id, ARN o alias de la clave de AWS KMS que envuelve las DEK. Obligatoria con `KMS_ADAPTER=aws`. */
    AWS_KMS_KEY_ID: z.string().min(1).optional(),
    /** Región de AWS KMS. Obligatoria con `KMS_ADAPTER=aws`. Las credenciales las resuelve el SDK, no esta configuración. */
    AWS_REGION: z.string().min(1).optional(),
    /** Origen del navegador que usa la API (verificación de `Origin` contra CSRF y enlaces de correo). */
    APP_ORIGIN: z.url().default('http://localhost:5173'),
    /** Carpeta de la SPA compilada; si se omite, la API no sirve el frontend (útil en desarrollo con Vite). */
    WEB_DIST_DIR: z.string().min(1).optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /**
     * Solo detrás de un balanceador de confianza: usa `X-Forwarded-For` para la IP del cliente.
     * `false`, `true` (toda la cadena), un número de saltos o una lista de IP/CIDR de los proxies.
     */
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((value, ctx): TrustProxySetting => {
        const setting = parseTrustProxy(value);
        if (setting === undefined) {
          // No se repite el valor: es configuración de red y no hay motivo para escribirla en un error.
          ctx.addIssue({ code: 'custom', message: 'invalid trust proxy setting' });
          return z.NEVER;
        }
        return setting;
      }),
    /** `log` escribe el enlace en el registro (solo desarrollo); `smtp` envía por el correo del dominio propio. */
    MAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURITY: z.enum(['starttls', 'tls', 'none']).default('starttls'),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM: z.string().min(3).optional(),
    /** Nombre que el autenticador muestra al registrar una llave de acceso. */
    WEBAUTHN_RP_NAME: z.string().min(1).max(100).default('IAM'),
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
    if (env.KMS_ADAPTER === 'aws') {
      for (const key of ['AWS_KMS_KEY_ID', 'AWS_REGION'] as const) {
        if (env[key] === undefined)
          ctx.addIssue({ code: 'custom', path: [key], message: 'required' });
      }
    }
    // La KEK local vive en un archivo: en producción debe usarse el KMS gestionado (TODO L1). La
    // comprobación del adaptador es una segunda barrera; esta falla antes, con un mensaje de configuración.
    if (env.NODE_ENV === 'production' && !PRODUCTION_KMS_ADAPTERS.includes(env.KMS_ADAPTER)) {
      ctx.addIssue({
        code: 'custom',
        path: ['KMS_ADAPTER'],
        message: 'the local key management is not allowed in production',
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
