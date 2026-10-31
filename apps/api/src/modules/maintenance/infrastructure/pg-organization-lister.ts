/**
 * Invariantes de seguridad
 * - Solo usa `auth.list_organization_ids()` (SECURITY DEFINER, solo `id`, `search_path` fijo): el rol
 *   de la aplicación no lee la tabla de organizaciones completa (ADR 0038).
 * - No abre transacción con `app.org_id`: aquí todavía no hay organización.
 */
import type { Pool } from 'pg';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import type { OrganizationLister } from '../application/ports/purge-ports.js';

export class PgOrganizationLister implements OrganizationLister {
  constructor(private readonly pool: Pool) {}

  async listIds(): Promise<readonly OrganizationId[]> {
    const result = await this.pool.query<{ organization_id: string }>(
      'select organization_id from auth.list_organization_ids()',
    );
    return result.rows.map((row) => asOrganizationId(row.organization_id));
  }
}
