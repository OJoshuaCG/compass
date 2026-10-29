/**
 * Recuperación de la Raíz que perdió su contraseña y sus factores (comando de operaciones, ADR 0037).
 * Se ejecuta con una conexión de administrador, nunca desde la API, y con los DOS custodios presentes:
 * cada uno aporta un código de emergencia de su grupo (A o B).
 *
 * La contraseña inicial y los códigos nuevos se imprimen una sola vez por la salida estándar (no pasan
 * por los registros). Los códigos presentados llegan por variables de entorno: cárgalas sin dejarlas
 * en el historial del intérprete (ver el runbook).
 */
import { Pool } from 'pg';
import { z } from 'zod';

import { Argon2PasswordHasher, ZxcvbnPasswordStrength } from './modules/identity/index.js';
import { NodeCryptoPrimitives } from './modules/crypto/index.js';
import { SmtpMailer } from './modules/notification/index.js';
import {
  MailerAdministratorNotifier,
  PgRootRecoveryStore,
  RecoverRoot,
  RootRecoveryRejectedError,
} from './modules/provisioning/index.js';
import type { AdministratorNotifier } from './modules/provisioning/index.js';

const inputSchema = z.object({
  PROVISION_DATABASE_URL: z.string().min(1),
  ORG_SLUG: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  // Los nombres no dicen de qué custodio es cada código: el almacén es quien comprueba los grupos.
  EMERGENCY_CODE_1: z.string().min(1),
  EMERGENCY_CODE_2: z.string().min(1),
  NODE_ENV: z.string().optional(),
  MAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURITY: z.enum(['starttls', 'tls', 'none']).default('starttls'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),
  APP_ORIGIN: z.string().min(1).optional(),
});

const parsed = inputSchema.safeParse(process.env);
if (!parsed.success) {
  // Solo los nombres de las variables con problema, nunca sus valores (algunos son códigos).
  const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Missing or invalid environment: ${names}`);
}
const input = parsed.data;

/** Sin transporte SMTP no hay aviso posible: se cuenta como fallido para que quede auditado y a la vista. */
const unavailableNotifier: AdministratorNotifier = {
  notify: (administrators) => Promise.resolve(administrators.length),
};

function buildNotifier(): AdministratorNotifier {
  if (input.MAIL_TRANSPORT !== 'smtp') return unavailableNotifier;
  if (
    input.SMTP_HOST === undefined ||
    input.MAIL_FROM === undefined ||
    input.APP_ORIGIN === undefined
  ) {
    throw new Error('Missing or invalid environment: SMTP_HOST, MAIL_FROM, APP_ORIGIN');
  }
  return new MailerAdministratorNotifier(
    new SmtpMailer(
      {
        host: input.SMTP_HOST,
        port: input.SMTP_PORT,
        security: input.SMTP_SECURITY,
        user: input.SMTP_USER,
        password: input.SMTP_PASSWORD,
        from: input.MAIL_FROM,
        baseUrl: input.APP_ORIGIN,
      },
      input.NODE_ENV,
    ),
  );
}

const pool = new Pool({ connectionString: input.PROVISION_DATABASE_URL, max: 2 });
const primitives = new NodeCryptoPrimitives();
try {
  const result = await new RecoverRoot({
    store: new PgRootRecoveryStore(pool),
    notifier: buildNotifier(),
    hasher: new Argon2PasswordHasher(),
    strength: new ZxcvbnPasswordStrength(),
    primitives: {
      randomBytes: (length) => primitives.randomBytes(length),
      sha256: (data) => primitives.sha256(data),
    },
    now: () => new Date(),
  }).execute({
    organizationSlug: input.ORG_SLUG,
    presentedCodes: [input.EMERGENCY_CODE_1, input.EMERGENCY_CODE_2],
  });

  const codesOf = (group: 'A' | 'B'): string[] =>
    result.emergencyCodes
      .filter((_code, index) => result.emergencyCodeGroups[index] === group)
      .map((code) => `  ${code}`);

  process.stdout.write(
    [
      '',
      'Raíz recuperada.',
      `  Persona Raíz: ${result.rootEmail}`,
      `  Contraseña inicial (de un solo uso): ${result.initialPassword}`,
      '',
      'Entrégala por un canal seguro. Se muestra solo esta vez y debe cambiarse en el primer ingreso,',
      'antes de registrar un segundo factor nuevo. Se cerraron todas sus sesiones y se invalidaron los',
      'códigos de emergencia anteriores.',
      '',
      'Códigos de emergencia NUEVOS. Cada custodio recibe SOLO los de su grupo:',
      '',
      'Custodio A:',
      ...codesOf('A'),
      '',
      'Custodio B:',
      ...codesOf('B'),
      '',
      'Imprímelos AHORA y repártelos fuera del sistema. Se muestran solo esta vez.',
      '',
      result.alert.recipients === 0 || result.alert.failed > 0
        ? `ATENCIÓN: el aviso a los Administradores NO llegó completo (destinatarios: ${String(result.alert.recipients)}, fallidos: ${String(result.alert.failed)}). Quedó auditado; avísales por otro canal.`
        : `Se avisó por correo a ${String(result.alert.recipients)} Administrador(es).`,
      '',
    ].join('\n'),
  );
} catch (error) {
  if (error instanceof RootRecoveryRejectedError) {
    // Mensaje único: no se revela qué comprobación falló.
    process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await pool.end();
}
