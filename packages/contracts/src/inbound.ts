import { z } from 'zod';

import { shareLevelSchema } from './accounts.js';
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
