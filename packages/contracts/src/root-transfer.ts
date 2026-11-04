import { z } from 'zod';

export const ROOT_TRANSFER_STATUSES = ['pending_acceptance', 'waiting'] as const;

/** Proponer el puesto de Raíz a un Administrador activo. */
export const proposeRootTransferRequestSchema = z.object({ targetUserId: z.uuid() });
export type ProposeRootTransferRequest = z.infer<typeof proposeRootTransferRequestSchema>;

/** La transferencia abierta de la organización (solo se muestra la que sigue en curso). */
export const rootTransferSchema = z.object({
  id: z.uuid(),
  fromUserId: z.uuid(),
  toUserId: z.uuid(),
  status: z.enum(ROOT_TRANSFER_STATUSES),
  requestedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  executesAt: z.iso.datetime().nullable(),
});
export type RootTransfer = z.infer<typeof rootTransferSchema>;
