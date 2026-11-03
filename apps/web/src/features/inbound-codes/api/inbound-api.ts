import {
  inboundCodesResponseSchema,
  inboundReceiptSchema,
  inboundViewsResponseSchema,
  type InboundCodesResponse,
  type InboundReceipt,
  type InboundViewSummary,
} from '@iam/contracts';

import { apiClient, createListFetcher, type ApiClient, type FetchPage } from '../../../shared/api';

/**
 * Claves de consulta de los códigos entrantes. Solo existen el listado de vistas y el historial,
 * que son metadatos. Los códigos NO tienen clave: se piden con `fetchInboundCodes`, que no pasa
 * por Query, para que el valor viva solo en el estado del componente (docs/frontend.md §9).
 */
export const inboundKeys = {
  all: ['inbound'] as const,
  views: () => [...inboundKeys.all, 'views'] as const,
  history: (viewId: string) => [...inboundKeys.all, 'history', viewId] as const,
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
