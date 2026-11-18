import {
  SMTP_LIMITS,
  SMTP_SECURITY_VALUES,
  smtpDestinationChanged,
  type SmtpSettings,
} from '@iam/contracts';
import { z } from 'zod';

/** Mismo tope que el CHECK de `integrations.name` en el servidor. */
const NAME_MAX_LENGTH = 200;

/** Puerto con que se abre el formulario: el de envío autenticado con STARTTLS. */
export const DEFAULT_SMTP_PORT = '587';
export const DEFAULT_SMTP_SECURITY = 'starttls' as const;

/** Comodidad para avisar antes de enviar; el servidor valida de nuevo (DNS, IP, remitente) y decide. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);
const hostSchema = z.string().trim().min(1).max(SMTP_LIMITS.hostMaxLength);
const portSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}$/)
  .refine((value) => Number(value) >= SMTP_LIMITS.portMin && Number(value) <= SMTP_LIMITS.portMax);
const securitySchema = z.enum(SMTP_SECURITY_VALUES);
const usernameSchema = z.string().trim().min(1).max(SMTP_LIMITS.usernameMaxLength);
const fromAddressSchema = z
  .string()
  .trim()
  .max(SMTP_LIMITS.fromAddressMaxLength)
  .regex(EMAIL_PATTERN);
// La contraseña no se recorta: un espacio al final puede ser parte de ella.
const passwordSchema = z.string().min(1).max(SMTP_LIMITS.passwordMaxLength);

const connectionShape = {
  name: nameSchema,
  host: hostSchema,
  port: portSchema,
  security: securitySchema,
  username: usernameSchema,
  fromAddress: fromAddressSchema,
};

export const createSmtpFormSchema = z.object({ ...connectionShape, password: passwordSchema });
export type SmtpFormValues = z.input<typeof createSmtpFormSchema>;

/**
 * Al editar la contraseña es opcional, salvo que cambie el servidor, el puerto, la seguridad o el usuario
 * y ya haya una guardada: la API lo exige igual, aquí se avisa antes de enviar. El campo vacío no se envía.
 */
export function buildEditSmtpFormSchema(
  current: Pick<SmtpSettings, 'host' | 'port' | 'security' | 'username' | 'hasPassword'>,
) {
  return z
    .object({ ...connectionShape, password: z.string().max(SMTP_LIMITS.passwordMaxLength) })
    .superRefine((values, context) => {
      const destinationChanged = smtpDestinationChanged(current, {
        host: values.host,
        port: Number(values.port),
        security: values.security,
        username: values.username,
      });
      if (destinationChanged && current.hasPassword && values.password === '') {
        // Mismo código que un campo vacío obligatorio: el aviso es el de «falta este dato».
        context.addIssue({
          code: 'too_small',
          origin: 'string',
          minimum: 1,
          inclusive: true,
          path: ['password'],
        });
      }
    });
}

export const rotateSmtpPasswordFormSchema = z.object({ password: passwordSchema });
export type RotateSmtpPasswordFormValues = z.input<typeof rotateSmtpPasswordFormSchema>;

/** Códigos estables que devuelve la prueba de envío cuando el servidor no la entregó. */
export const SMTP_TEST_FAILURE_CODES = [
  'HOST_UNRESOLVED',
  'HOST_NOT_ALLOWED',
  'CONNECTION_FAILED',
  'TLS_FAILED',
  'AUTH_REJECTED',
  'SENDER_REJECTED',
  'TIMEOUT',
  'SEND_FAILED',
] as const;
export type SmtpTestFailureCode = (typeof SMTP_TEST_FAILURE_CODES)[number];

export function isSmtpTestFailureCode(outcome: string): outcome is SmtpTestFailureCode {
  return (SMTP_TEST_FAILURE_CODES as readonly string[]).includes(outcome);
}

/** El servidor vigente: la API admite uno activo por organización, los archivados no cuentan. */
export function findActiveSmtpSettings(
  settings: readonly SmtpSettings[],
): SmtpSettings | undefined {
  return settings.find((entry) => entry.status === 'active');
}
