import {
  inboundConfigurableViewsResponseSchema,
  inboundTemplatesResponseSchema,
  inboundViewSchema,
  inboundCodesResponseSchema,
  inboundSourceConnectionSchema,
  inboundSourceSchema,
  inboundSourcesResponseSchema,
  inboundReceiptSchema,
  inboundResetsResponseSchema,
  inboundViewShareSchema,
  inboundViewsResponseSchema,
  type CreateInboundSourceRequest,
  type CreateShareRequest,
  type CreateInboundViewRequest,
  type InboundConfigurableView,
  type InboundTemplateSummary,
  type InboundView,
  type UpdateInboundViewRequest,
  type InboundCodesResponse,
  type InboundSource,
  type InboundSourceConnection,
  type InboundSourceSummary,
  type InboundResetsResponse,
  type InboundReceipt,
  type InboundViewShare,
  type InboundViewSummary,
  type PutInboundSourceConnectionRequest,
} from '@iam/contracts';
import { z } from 'zod';

import {
  apiClient,
  createListFetcher,
  noContentSchema,
  type ApiClient,
  type FetchPage,
} from '../../../shared/api';

/**
 * Claves de consulta de los códigos entrantes. Solo existen los listados de vistas y de fuentes y el
 * historial, que son metadatos. Los códigos NO tienen clave: se piden con `fetchInboundCodes`, que no pasa
 * por Query, para que el valor viva solo en el estado del componente (docs/frontend.md §9).
 */
export const inboundKeys = {
  all: ['inbound'] as const,
  views: () => [...inboundKeys.all, 'views'] as const,
  configurableViews: () => [...inboundKeys.all, 'configurable-views'] as const,
  templates: () => [...inboundKeys.all, 'templates'] as const,
  sources: () => [...inboundKeys.all, 'sources'] as const,
  connection: (sourceId: string) => [...inboundKeys.all, 'connection', sourceId] as const,
  history: (viewId: string) => [...inboundKeys.all, 'history', viewId] as const,
  viewShares: (viewId: string) => [...inboundKeys.all, 'view-shares', viewId] as const,
};

/** `GET /inbound/views` (permiso `inbound.read_codes`): las vistas que la persona puede leer, sin paginar. */
export async function fetchInboundViews(
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<InboundViewSummary[]> {
  const response = await client.get('/inbound/views', inboundViewsResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/**
 * `GET /inbound/views/:viewId/codes`: los códigos vigentes de la vista. Devuelve el valor al
 * llamador y nada más: se invoca con `useAsyncAction`, nunca con `useQuery`, que lo guardaría en la caché.
 */
export function fetchInboundCodes(
  viewId: string,
  client: ApiClient = apiClient,
): Promise<InboundCodesResponse> {
  return client.get(`/inbound/views/${viewId}/codes`, inboundCodesResponseSchema);
}

/** `GET /inbound/views/:viewId/history?cursor=&limit=`: recepciones sin valores, lo más reciente primero. */
export function createInboundHistoryFetcher(
  viewId: string,
  client: ApiClient = apiClient,
): FetchPage<InboundReceipt> {
  return createListFetcher(client, `/inbound/views/${viewId}/history`, inboundReceiptSchema);
}

/**
 * `POST /inbound/views/:viewId/resets/reveal` (permiso `inbound.reveal_reset`, nivel MANAGE, reautenticación
 * y motivo): los restablecimientos vigentes de la vista. Es un evento crítico que avisa a la Raíz. Igual que
 * los códigos, el valor se devuelve al llamador y nunca pasa por Query; la reautenticación la abre el cliente.
 */
export function revealInboundResets(
  viewId: string,
  reason: string,
  client: ApiClient = apiClient,
): Promise<InboundResetsResponse> {
  return client.post(`/inbound/views/${viewId}/resets/reveal`, inboundResetsResponseSchema, {
    body: { reason },
  });
}

/** `GET /inbound/sources` (permiso `inbound.configure`): las fuentes con el nivel propio, sin paginar (tope de 200). */
export async function fetchInboundSources(
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<InboundSourceSummary[]> {
  const response = await client.get('/inbound/sources', inboundSourcesResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/** `POST /inbound/sources` (201): idempotente; el cliente envía la `Idempotency-Key` en todo POST. 409 si la dirección ya existe. */
export function createInboundSource(
  body: CreateInboundSourceRequest,
  client: ApiClient = apiClient,
): Promise<InboundSource> {
  return client.post('/inbound/sources', inboundSourceSchema, { body });
}

/** `PATCH /inbound/sources/:id` (exige nivel EDIT): solo el nombre. La ruta es idempotente y exige la clave. */
export function renameInboundSource(
  id: string,
  displayName: string,
  client: ApiClient = apiClient,
): Promise<InboundSource> {
  return client.patch(`/inbound/sources/${id}`, inboundSourceSchema, {
    body: { displayName },
    idempotencyKey: crypto.randomUUID(),
  });
}

/** `POST /inbound/sources/:id/archive` (204, exige nivel MANAGE): deja de recibir códigos y oculta sus vistas. */
export function archiveInboundSource(id: string, client: ApiClient = apiClient) {
  return client.post(`/inbound/sources/${id}/archive`, noContentSchema);
}

/** Respuesta de `GET /inbound/sources/:id/connection`: `null` si la fuente aún no tiene conexión. */
const inboundSourceConnectionResponseSchema = z.object({
  connection: inboundSourceConnectionSchema.nullable(),
});

/**
 * `GET /inbound/sources/:id/connection` (nivel EDIT): servidor, usuario y destinatarios, nunca la
 * contraseña (solo `hasPassword`). Al no llevar secretos puede pasar por Query.
 */
export async function fetchInboundSourceConnection(
  sourceId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<InboundSourceConnection | null> {
  const response = await client.get(
    `/inbound/sources/${sourceId}/connection`,
    inboundSourceConnectionResponseSchema,
    { ...(signal === undefined ? {} : { signal }) },
  );
  return response.connection;
}

/**
 * `PUT /inbound/sources/:id/connection` (nivel EDIT; los destinatarios exigen MANAGE). El cuerpo puede
 * llevar la contraseña de la casilla: se invoca con `useAsyncAction`, nunca con una mutación de Query,
 * para que no quede en su caché. Guardar una contraseña exige reautenticación, que abre el cliente.
 */
export function putInboundSourceConnection(
  sourceId: string,
  body: PutInboundSourceConnectionRequest,
  client: ApiClient = apiClient,
): Promise<InboundSourceConnection> {
  return client.put(`/inbound/sources/${sourceId}/connection`, inboundSourceConnectionSchema, {
    body,
  });
}

/** `GET /inbound/configurable-views` (permiso `inbound.configure`): las vistas que la persona puede administrar, con su nivel. */
export async function fetchInboundConfigurableViews(
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<InboundConfigurableView[]> {
  const response = await client.get(
    '/inbound/configurable-views',
    inboundConfigurableViewsResponseSchema,
    { ...(signal === undefined ? {} : { signal }) },
  );
  return response.data;
}

/** `GET /inbound/templates`: las plantillas vigentes (nombre y tipo) para armar una vista. */
export async function fetchInboundTemplates(
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<InboundTemplateSummary[]> {
  const response = await client.get('/inbound/templates', inboundTemplatesResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
  return response.data;
}

/** `POST /inbound/views` (201): idempotente; exige EDIT o MANAGE sobre la fuente. 409 si el nombre ya existe en ella. */
export function createInboundView(
  body: CreateInboundViewRequest,
  client: ApiClient = apiClient,
): Promise<InboundView> {
  return client.post('/inbound/views', inboundViewSchema, { body });
}

/** `PATCH /inbound/views/:id` (exige EDIT o MANAGE): solo viajan los campos que cambiaron. La ruta exige la clave. */
export function updateInboundView(
  id: string,
  body: UpdateInboundViewRequest,
  client: ApiClient = apiClient,
): Promise<InboundView> {
  return client.patch(`/inbound/views/${id}`, inboundViewSchema, {
    body,
    idempotencyKey: crypto.randomUUID(),
  });
}

/** `POST /inbound/views/:id/archive` (204, exige MANAGE): la vista deja de mostrarse y se revocan sus accesos compartidos. */
export function archiveInboundView(id: string, client: ApiClient = apiClient) {
  return client.post(`/inbound/views/${id}/archive`, noContentSchema);
}

const inboundViewSharesResponseSchema = z.object({ data: z.array(inboundViewShareSchema) });

/**
 * `GET /inbound/views/:id/shares` (exige `share.manage` y MANAGE sobre la vista): quién tiene acceso
 * vigente a la vista, completo y sin paginar.
 */
export async function fetchInboundViewShares(
  viewId: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<InboundViewShare[]> {
  const response = await client.get(
    `/inbound/views/${viewId}/shares`,
    inboundViewSharesResponseSchema,
    { ...(signal === undefined ? {} : { signal }) },
  );
  return response.data;
}

/**
 * `POST /inbound/views/:id/shares`: comparte la vista con una persona. El cliente HTTP añade la clave
 * de idempotencia, estable ante reintentos.
 */
export function createInboundViewShare(
  viewId: string,
  body: CreateShareRequest,
  client: ApiClient = apiClient,
): Promise<InboundViewShare> {
  return client.post(`/inbound/views/${viewId}/shares`, inboundViewShareSchema, { body });
}

/** `POST /inbound/views/:id/shares/:shareId/revoke` (204): el acceso se corta desde la siguiente petición. */
export function revokeInboundViewShare(
  viewId: string,
  shareId: string,
  client: ApiClient = apiClient,
) {
  return client.post(`/inbound/views/${viewId}/shares/${shareId}/revoke`, noContentSchema);
}
