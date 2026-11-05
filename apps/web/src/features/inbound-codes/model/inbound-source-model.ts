import {
  createInboundSourceRequestSchema,
  type CreateInboundSourceRequest,
  type InboundSourceSummary,
} from '@iam/contracts';
import { z } from 'zod';

/**
 * Formulario de alta: solo dirección y nombre. `accountId` queda fuera a propósito: ligar la fuente
 * a una cuenta de la bóveda es otra pantalla. Reutiliza las reglas del contrato para cada campo.
 */
export const createInboundSourceFormSchema = z.object({
  address: createInboundSourceRequestSchema.shape.address,
  displayName: createInboundSourceRequestSchema.shape.displayName,
});
export type CreateInboundSourceFormValues = z.input<typeof createInboundSourceFormSchema>;

/** Cuerpo exacto del alta: lo que el formulario ya validó y normalizó, sin campos extra. */
export function buildCreateSourceBody(
  values: z.output<typeof createInboundSourceFormSchema>,
): CreateInboundSourceRequest {
  return { address: values.address, displayName: values.displayName };
}

/** Formulario de renombrado: el nombre es obligatorio (el contrato lo admite opcional por el `accountId`). */
export const renameInboundSourceFormSchema = z.object({
  displayName: createInboundSourceRequestSchema.shape.displayName,
});
export type RenameInboundSourceFormValues = z.input<typeof renameInboundSourceFormSchema>;

/**
 * Decisiones de comodidad para ofrecer o no una acción; el servidor decide siempre. Una fuente
 * archivada ya no admite cambios, así que tampoco se ofrecen.
 */
export function canRenameSource(source: InboundSourceSummary): boolean {
  return source.status !== 'archived' && (source.level === 'EDIT' || source.level === 'MANAGE');
}

export function canArchiveSource(source: InboundSourceSummary): boolean {
  return source.status !== 'archived' && source.level === 'MANAGE';
}
