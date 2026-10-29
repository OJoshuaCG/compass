/**
 * Invariantes de seguridad
 * - Solo identificadores: la función `auth.list_organization_ids()` no devuelve nombres ni ajustes
 *   (ADR 0038). Todo lo demás se hace después por organización, con RLS.
 * - Corre fuera de una transacción de organización: es la única lectura sin `app.org_id`.
 */
import type { Pool } from 'pg';

import { asOrganizationId, type OrganizationId } from '../../../shared/kernel/index.js';

export class PgOrganizationLister {
  constructor(private readonly pool: Pool) {}

  async listIds(): Promise<OrganizationId[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      'select id from auth.list_organization_ids() as id',
    );
    return rows.map((row) => asOrganizationId(row.id));
  }
}
