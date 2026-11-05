/**
 * Invariantes de seguridad
 * - Solo usa `auth.list_pollable_inbound_sources()` (SECURITY DEFINER, solo ids, `search_path` fijo): el
 *   rol del worker no lee `mail_sources` sin organización fijada.
 * - No abre transacción con `app.org_id`: aquí todavía no hay organización; cada fuente se sondea después
 *   con la suya fijada por los repositorios.
 */
import type { Pool } from 'pg';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { PollableSourceLister } from '../application/ports/pollable-source-lister.js';
import type { SourceRef } from '../application/ports/poll-state-store.js';

interface PollableSourceRow {
  organization_id: string;
  source_id: string;
}

export class PgPollableSourceLister implements PollableSourceLister {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<readonly SourceRef[]> {
    const result = await this.pool.query<PollableSourceRow>(
      'select organization_id, source_id from auth.list_pollable_inbound_sources()',
    );
    return result.rows.map((row) => ({
      organizationId: asOrganizationId(row.organization_id),
      sourceId: row.source_id,
    }));
  }
}
