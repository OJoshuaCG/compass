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
