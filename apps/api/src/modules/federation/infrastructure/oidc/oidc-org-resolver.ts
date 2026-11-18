/**
 * Resuelve la organización de una llamada del proveedor OIDC ANTES de abrir la transacción con aislamiento
 * por filas (ADR 0052, decisión 5).
 *
 * Invariantes de seguridad
 * - Solo usa las funciones `auth.*` de solo lectura de la migración 0045 (una clave exacta cada una, sin
 *   listados ni patrones). Nunca escribe y nunca devuelve datos del cliente o del token, solo la organización.
 * - Un registro vencido o inexistente se resuelve como `null`; quien llama lo trata como «no existe».
 */
import type { Pool } from 'pg';

interface OrganizationRow {
  readonly organization_id: string;
}

interface ClientOrganizationRow extends OrganizationRow {
  readonly status: 'active' | 'disabled';
}

export class PgOidcOrgResolver {
  constructor(private readonly pool: Pool) {}

  /** Organización dueña de un cliente ACTIVO; un cliente deshabilitado no se resuelve. */
  async byActiveClientId(clientId: string): Promise<string | null> {
    const result = await this.pool.query<ClientOrganizationRow>(
      'select organization_id, status from auth.find_oidc_client_org($1)',
      [clientId],
    );
    const row = result.rows[0];
    return row === undefined || row.status !== 'active' ? null : row.organization_id;
  }

  async byPayloadKey(model: string, keyHash: Uint8Array): Promise<string | null> {
    const result = await this.pool.query<OrganizationRow>(
      'select organization_id from auth.find_oidc_payload_org($1, $2)',
      [model, Buffer.from(keyHash)],
    );
    return result.rows[0]?.organization_id ?? null;
  }

  async byUid(model: string, uid: string): Promise<string | null> {
    const result = await this.pool.query<OrganizationRow>(
      'select organization_id from auth.find_oidc_payload_org_by_uid($1, $2)',
      [model, uid],
    );
    return result.rows[0]?.organization_id ?? null;
  }
}
