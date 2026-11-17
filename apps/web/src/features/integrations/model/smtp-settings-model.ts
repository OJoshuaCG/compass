import { SMTP_SECURITY_VALUES, type SmtpSettings } from '@iam/contracts';
import { z } from 'zod';

/** Mismo tope que el CHECK de `integrations.name` en el servidor. */
const NAME_MAX_LENGTH = 200;
const HOST_MAX_LENGTH = 300;
const USERNAME_MAX_LENGTH = 300;
const ADDRESS_MAX_LENGTH = 320;
const PASSWORD_MAX_LENGTH = 1024;
const PORT_MIN = 1;
const PORT_MAX = 65_535;

/** Puerto con que se abre el formulario: el de envío autenticado con STARTTLS. */
export const DEFAULT_SMTP_PORT = '587';
export const DEFAULT_SMTP_SECURITY = 'starttls' as const;

/** Comodidad para avisar antes de enviar; el servidor valida de nuevo (DNS, IP, remitente) y decide. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);
const hostSchema = z.string().trim().min(1).max(HOST_MAX_LENGTH);
const portSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}$/)
  .refine((value) => Number(value) >= PORT_MIN && Number(value) <= PORT_MAX);
const securitySchema = z.enum(SMTP_SECURITY_VALUES);
const usernameSchema = z.string().trim().min(1).max(USERNAME_MAX_LENGTH);
const fromAddressSchema = z.string().trim().max(ADDRESS_MAX_LENGTH).regex(EMAIL_PATTERN);
// La contraseña no se recorta: un espacio al final puede ser parte de ella.
const passwordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

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
 * Al editar no se pide la contraseña (se cambia aparte), pero el formulario comparte la forma de los
 * valores con el de alta; el campo viaja vacío y nunca se envía.
 */
export const editSmtpFormSchema = z.object({ ...connectionShape, password: z.string() });

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
