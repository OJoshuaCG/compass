import {
  createInboundViewRequestSchema,
  type CreateInboundViewRequest,
  type InboundConfigurableView,
  type InboundSourceSummary,
  type UpdateInboundViewRequest,
} from '@iam/contracts';
import { z } from 'zod';

/**
 * Formulario de alta: fuente, nombre y plantillas. Reutiliza las reglas del contrato (nombre con
 * recorte y tope, de 1 a 20 plantillas) para que cliente y servidor no se desalineen.
 */
export const createInboundViewFormSchema = z.object({
  sourceId: createInboundViewRequestSchema.shape.sourceId,
  name: createInboundViewRequestSchema.shape.name,
  templateIds: createInboundViewRequestSchema.shape.templateIds,
});
export type CreateInboundViewFormValues = z.input<typeof createInboundViewFormSchema>;

/** Cuerpo exacto del alta: lo que el formulario ya validó, sin campos extra. */
export function buildCreateViewBody(
  values: z.output<typeof createInboundViewFormSchema>,
): CreateInboundViewRequest {
  return { sourceId: values.sourceId, name: values.name, templateIds: values.templateIds };
}

/**
 * Formulario de edición. Si el catálogo de plantillas no se pudo cargar (o está vacío) no se puede
 * elegir ninguna, así que solo se valida el nombre: renombrar no debe quedar bloqueado por eso.
 */
export function buildEditInboundViewFormSchema(templatesAvailable: boolean) {
  return z.object({
    name: createInboundViewRequestSchema.shape.name,
    templateIds: templatesAvailable
      ? createInboundViewRequestSchema.shape.templateIds
      : z.array(z.uuid()),
  });
}
export type EditInboundViewFormValues = z.input<ReturnType<typeof buildEditInboundViewFormSchema>>;

function sameIds(first: readonly string[], second: readonly string[]): boolean {
  if (first.length !== second.length) return false;
  const secondSet = new Set(second);
  return first.every((id) => secondSet.has(id));
}

/**
 * Plantillas que la vista tiene hoy y que el catálogo aún ofrece. Una plantilla archivada no se
 * puede marcar ni desmarcar: se descarta de la selección inicial para que el servidor no rechace
 * un guardado con `INBOUND.TEMPLATE_INVALID` por algo que la persona no ve.
 */
export function initialTemplateIds(
  view: InboundConfigurableView,
  offeredTemplateIds: readonly string[],
): string[] {
  const offered = new Set(offeredTemplateIds);
  return view.templateIds.filter((id) => offered.has(id));
}

/**
 * Cuerpo del PATCH con solo lo que cambió, o `null` si no cambió nada (entonces no se envía).
 * El nombre se compara ya recortado, igual que lo normaliza el contrato.
 */
export function buildUpdateViewBody(
  view: InboundConfigurableView,
  initialIds: readonly string[],
  values: { name: string; templateIds: readonly string[] },
): UpdateInboundViewRequest | null {
  const body: UpdateInboundViewRequest = {};
  if (values.name !== view.name) body.name = values.name;
  if (!sameIds(values.templateIds, initialIds)) body.templateIds = [...values.templateIds];
  return body.name === undefined && body.templateIds === undefined ? null : body;
}

/**
 * Decisiones de comodidad para ofrecer o no una acción; el servidor decide siempre. Crear exige
 * EDIT o MANAGE sobre una fuente no archivada.
 */
export function canCreateViewOnSource(source: InboundSourceSummary): boolean {
  return source.status !== 'archived' && (source.level === 'EDIT' || source.level === 'MANAGE');
}

export function canEditView(view: InboundConfigurableView): boolean {
  return view.level === 'EDIT' || view.level === 'MANAGE';
}

export function canArchiveView(view: InboundConfigurableView): boolean {
  return view.level === 'MANAGE';
}

/**
 * Ver, dar y revocar accesos a una vista exige dos llaves: el permiso `share.manage` y MANAGE sobre la
 * vista. Solo es comodidad para la interfaz: el servidor vuelve a decidir (AUTHZ.SHARE).
 */
export function canManageViewShares(
  hasSharePermission: boolean,
  view: InboundConfigurableView,
): boolean {
  return hasSharePermission && view.level === 'MANAGE';
}
