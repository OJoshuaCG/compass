import type { InteractionDetails, InteractionResult } from 'oidc-provider';

/**
 * Lo que las interacciones de login y consentimiento necesitan del proveedor OIDC. Genérico en la petición
 * y la respuesta HTTP para que esta capa no dependa de Node: la capa `interface` los fija.
 */
export interface InteractionProvider<Request, Response> {
  interactionDetails(request: Request, response: Response): Promise<InteractionDetails>;
  interactionFinished(
    request: Request,
    response: Response,
    result: InteractionResult,
  ): Promise<void>;
  /** Concede a la persona los permisos que el cliente pidió y devuelve el identificador de la concesión. */
  grantAll(details: InteractionDetails, accountId: string, clientId: string): Promise<string>;
}
