import { z } from 'zod';

import { shareLevelSchema } from './accounts.js';
import { emailSchema } from './text.js';
import { fixedOrderPageQuerySchema, pageSchema } from './pagination.js';
import { shareGranteeTypeSchema } from './shares.js';

/** Tipo de plantilla que casó con una recepción del historial. */
export const INBOUND_TEMPLATE_KINDS = ['login_code', 'reset_code', 'reset_link'] as const;
export const inboundTemplateKindSchema = z.enum(INBOUND_TEMPLATE_KINDS);
export type InboundTemplateKind = z.infer<typeof inboundTemplateKindSchema>;

/**
 * Un código de acceso vigente. El valor solo viaja en esta respuesta (sin caché) y vence en `expiresAt`:
 * la pantalla lo muestra y lo descarta, nunca lo guarda.
 */
export const inboundCodeSchema = z.object({
  itemId: z.uuid(),
  code: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type InboundCode = z.infer<typeof inboundCodeSchema>;

export const inboundCodesResponseSchema = z.object({ data: z.array(inboundCodeSchema) });
export type InboundCodesResponse = z.infer<typeof inboundCodesResponseSchema>;

/**
 * Revelación de restablecimientos de una vista (ADR 0045): exige MANAGE, reautenticación y motivo escrito.
 * El esquema acepta cualquier motivo a propósito: uno ausente, que no es texto o fuera de largo llega al
 * caso de uso, que lo niega con auditoría (`isValidRevealReason`). Rechazarlo aquí sería una negación sin
 * rastro. El tamaño total del cuerpo lo acota el límite por defecto de Fastify (1 MiB).
 */
export const revealInboundResetsRequestSchema = z.object({
  reason: z.unknown().optional(),
});
export type RevealInboundResetsRequest = z.infer<typeof revealInboundResetsRequestSchema>;

/** Un restablecimiento vigente (código o enlace). Solo viaja en esta respuesta, sin caché, y nunca por SSE. */
export const inboundResetSchema = z.object({
  itemId: z.uuid(),
  kind: z.enum(['reset_code', 'reset_link']),
  valueType: z.enum(['code', 'link']),
  value: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type InboundReset = z.infer<typeof inboundResetSchema>;

export const inboundResetsResponseSchema = z.object({ data: z.array(inboundResetSchema) });
export type InboundResetsResponse = z.infer<typeof inboundResetsResponseSchema>;

/** Recepción aceptada que casó con la vista: sin asunto, remitente ni valores. */
export const inboundReceiptSchema = z.object({
  id: z.uuid(),
  receivedAt: z.iso.datetime(),
  signingDomain: z.string().nullable(),
  templateKind: inboundTemplateKindSchema,
});
export type InboundReceipt = z.infer<typeof inboundReceiptSchema>;

/** Historial de orden fijo (lo más reciente primero): solo cursor y tamaño de página. */
export const inboundHistoryQuerySchema = fixedOrderPageQuerySchema;
export type InboundHistoryQuery = z.infer<typeof inboundHistoryQuerySchema>;

export const inboundHistoryResponseSchema = pageSchema(inboundReceiptSchema);
export type InboundHistoryResponse = z.infer<typeof inboundHistoryResponseSchema>;

/** Una compartición vigente de una vista de correo. `granteeName` es el nombre visible de la persona o del grupo. */
export const inboundViewShareSchema = z.object({
  id: z.uuid(),
  viewId: z.uuid(),
  granteeType: shareGranteeTypeSchema,
  granteeId: z.uuid(),
  granteeName: z.string(),
  level: shareLevelSchema,
  /** `null` cuando el acceso no caduca. */
  expiresAt: z.iso.datetime().nullable(),
  grantedBy: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type InboundViewShare = z.infer<typeof inboundViewShareSchema>;

const INBOUND_NAME_MAX_LENGTH = 200;
/** Tope de plantillas por vista: una vista que casa con decenas de plantillas ya no se puede revisar. */
export const MAX_TEMPLATES_PER_VIEW = 20;

export const INBOUND_SOURCE_STATUSES = ['active', 'suspended', 'archived'] as const;

/** Una fuente de mensajes entrantes (hoy solo correo). */
export const inboundSourceSchema = z.object({
  id: z.uuid(),
  channel: z.enum(['mail', 'sms']),
  address: z.string(),
  displayName: z.string(),
  /** Cuenta de la bóveda a la que está ligada, o `null`. */
  accountId: z.uuid().nullable(),
  status: z.enum(INBOUND_SOURCE_STATUSES),
  createdAt: z.iso.datetime(),
});
export type InboundSource = z.infer<typeof inboundSourceSchema>;

export const createInboundSourceRequestSchema = z.object({
  address: emailSchema,
  displayName: z.string().trim().min(1).max(INBOUND_NAME_MAX_LENGTH),
  accountId: z.uuid().optional(),
});
export type CreateInboundSourceRequest = z.infer<typeof createInboundSourceRequestSchema>;

export const updateInboundSourceRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(INBOUND_NAME_MAX_LENGTH).optional(),
    /** `null` desliga la fuente de su cuenta. */
    accountId: z.uuid().nullable().optional(),
  })
  .refine((body) => body.displayName !== undefined || body.accountId !== undefined, {
    message: 'At least one field is required',
  });
export type UpdateInboundSourceRequest = z.infer<typeof updateInboundSourceRequestSchema>;

/** Una vista de una fuente: el subconjunto de plantillas que sus lectores pueden ver. */
export const inboundViewSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  name: z.string(),
  templateIds: z.array(z.uuid()),
  createdAt: z.iso.datetime(),
});
export type InboundView = z.infer<typeof inboundViewSchema>;

const templateIdsSchema = z.array(z.uuid()).min(1).max(MAX_TEMPLATES_PER_VIEW);

export const createInboundViewRequestSchema = z.object({
  sourceId: z.uuid(),
  name: z.string().trim().min(1).max(INBOUND_NAME_MAX_LENGTH),
  templateIds: templateIdsSchema,
});
export type CreateInboundViewRequest = z.infer<typeof createInboundViewRequestSchema>;

export const updateInboundViewRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(INBOUND_NAME_MAX_LENGTH).optional(),
    templateIds: templateIdsSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.templateIds !== undefined, {
    message: 'At least one field is required',
  });
export type UpdateInboundViewRequest = z.infer<typeof updateInboundViewRequestSchema>;

/** Tope de destinatarios aceptados por fuente (ADR 0045): entradas exactas, sin comodines ni dominios. */
export const MAX_ACCEPTED_RECIPIENTS = 10;
export const MAIL_TLS_MODES = ['tls', 'starttls'] as const;
export type MailTlsMode = (typeof MAIL_TLS_MODES)[number];
/**
 * Puerto fijo por modo (ADR 0045): 993 con TLS implícito o 143 con STARTTLS forzado. Cualquier otro puerto
 * se rechaza al guardar: un puerto arbitrario convierte al worker en un escáner de la red.
 */
export const MAIL_PORT_BY_TLS_MODE: Readonly<Record<MailTlsMode, number>> = {
  tls: 993,
  starttls: 143,
};
const MAIL_PASSWORD_MAX_LENGTH = 1024;
const MAIL_USERNAME_MAX_LENGTH = 320;
const HOSTNAME_MAX_LENGTH = 253;
const HOSTNAME_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME_PATTERN = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})+$`);
const NUMERIC_LABEL_PATTERN = /^[0-9]+$/;

/**
 * Nombre de host DNS en minúsculas, con al menos un punto. Una IP literal se rechaza (su última etiqueta es
 * numérica): el destino se decide por DNS y la guardia de red del worker lo vuelve a comprobar al conectar.
 */
const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(HOSTNAME_MAX_LENGTH)
  .regex(HOSTNAME_PATTERN)
  .refine((host) => !NUMERIC_LABEL_PATTERN.test(host.split('.').at(-1) ?? ''), {
    message: 'An IP address is not allowed; use a host name',
  });

export const putInboundSourceConnectionRequestSchema = z
  .object({
    host: hostnameSchema,
    port: z.number().int(),
    tlsMode: z.enum(MAIL_TLS_MODES),
    username: z.string().trim().min(1).max(MAIL_USERNAME_MAX_LENGTH),
    /** `authserv-id` del servidor del buzón: solo se confía en su cabecera `Authentication-Results`. */
    authservId: hostnameSchema,
    acceptedRecipients: z.array(emailSchema).min(1).max(MAX_ACCEPTED_RECIPIENTS).optional(),
    /** Nunca se devuelve ni se registra. Guardarla exige reautenticación reciente. */
    password: z.string().min(1).max(MAIL_PASSWORD_MAX_LENGTH).optional(),
  })
  .refine((body) => body.port === MAIL_PORT_BY_TLS_MODE[body.tlsMode], {
    path: ['port'],
    message: 'Port must be 993 with TLS or 143 with STARTTLS',
  });
export type PutInboundSourceConnectionRequest = z.infer<
  typeof putInboundSourceConnectionRequestSchema
>;

export const inboundSourceConnectionSchema = z.object({
  sourceId: z.uuid(),
  host: z.string(),
  port: z.number().int(),
  tlsMode: z.enum(MAIL_TLS_MODES),
  username: z.string(),
  authservId: z.string(),
  acceptedRecipients: z.array(z.string()),
  /** Si hay contraseña guardada; la contraseña en sí nunca sale de la API. */
  hasPassword: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type InboundSourceConnection = z.infer<typeof inboundSourceConnectionSchema>;
