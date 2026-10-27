import type { OrganizationId } from '../../../../shared/kernel/index.js';

export interface GeneratedDataKey {
  /** DEK en claro: vive solo en memoria, con TTL, y se sobrescribe con ceros al expulsarse. */
  readonly plaintext: Uint8Array;
  readonly wrapped: Uint8Array;
  readonly keyRef: string;
}

/**
 * KMS detrás de un puerto (AWS KMS de referencia). La KEK nunca sale del KMS.
 * `organizationId` viaja como contexto de cifrado: una DEK envuelta para la organización A
 * no se puede abrir pidiendo la B.
 */
export interface KeyManagementPort {
  generateDataKey(input: { readonly organizationId: OrganizationId }): Promise<GeneratedDataKey>;
  decryptDataKey(input: {
    readonly organizationId: OrganizationId;
    readonly wrapped: Uint8Array;
    readonly keyRef: string;
  }): Promise<Uint8Array>;
}
