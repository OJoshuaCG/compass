/**
 * Borrado de concesiones OIDC sobre PostgreSQL (`oidc_payloads`).
 *
 * Invariantes de seguridad
 * - Corre en la transacción del llamador: RLS limita el borrado a la organización en curso, así que una
 *   sesión o persona de otra organización nunca se toca por error.
 * - Una lista vacía de sesiones no borra nada (nunca se convierte en «todo»).
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { GrantStore } from '../application/ports/grant-store.js';
import type { BackchannelLogoutTarget } from '../domain/backchannel-logout.js';

interface SessionAuthorizationsRow {
  readonly authorizations: unknown;
}

/**
 * De `payload.authorizations` (`{ [clientId]: { sid, grantId } }`) saca cada aplicación con su `sid`.
 * Una forma inesperada se ignora: no hay a quién avisar, pero la revocación sigue.
 */
function targetsFromAuthorizations(
  rows: readonly SessionAuthorizationsRow[],
): BackchannelLogoutTarget[] {
  const targets: BackchannelLogoutTarget[] = [];
  for (const row of rows) {
    if (typeof row.authorizations !== 'object' || row.authorizations === null) continue;
    for (const [clientId, authorization] of Object.entries(row.authorizations)) {
      const sid = (authorization as { sid?: unknown } | null)?.sid;
      if (typeof sid === 'string' && sid !== '') targets.push({ clientId, sid });
    }
  }
  return targets;
}

export class PgGrantStore implements GrantStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async findLogoutTargetsBySessions(
    sessionIds: readonly string[],
  ): Promise<readonly BackchannelLogoutTarget[]> {
    if (sessionIds.length === 0) return [];
    const result = await this.transactions.current().query<SessionAuthorizationsRow>(
      `select payload -> 'authorizations' as authorizations from oidc_payloads
       where model = 'Session' and compass_session_id = any($1::uuid[])`,
      [[...sessionIds]],
    );
    return targetsFromAuthorizations(result.rows);
  }

  async findLogoutTargetsByUserExceptSession(
    userId: string,
    keepSessionId: string,
  ): Promise<readonly BackchannelLogoutTarget[]> {
    const result = await this.transactions.current().query<SessionAuthorizationsRow>(
      `select payload -> 'authorizations' as authorizations from oidc_payloads
       where model = 'Session' and user_id = $1 and compass_session_id is distinct from $2::uuid`,
      [userId, keepSessionId],
    );
    return targetsFromAuthorizations(result.rows);
  }

  async findLogoutTargetsByUser(userId: string): Promise<readonly BackchannelLogoutTarget[]> {
    const result = await this.transactions.current().query<SessionAuthorizationsRow>(
      `select payload -> 'authorizations' as authorizations from oidc_payloads
       where model = 'Session' and user_id = $1`,
      [userId],
    );
    return targetsFromAuthorizations(result.rows);
  }

  async deleteBySessions(sessionIds: readonly string[]): Promise<number> {
    if (sessionIds.length === 0) return 0;
    const result = await this.transactions
      .current()
      .query(`delete from oidc_payloads where compass_session_id = any($1::uuid[])`, [
        [...sessionIds],
      ]);
    return result.rowCount ?? 0;
  }

  async deleteByUserExceptSession(userId: string, keepSessionId: string): Promise<number> {
    // `is distinct from` conserva también las filas sin sesión ligada: no pertenecen a «la otra sesión».
    const result = await this.transactions
      .current()
      .query(
        `delete from oidc_payloads where user_id = $1 and compass_session_id is distinct from $2::uuid`,
        [userId, keepSessionId],
      );
    return result.rowCount ?? 0;
  }

  async deleteByUser(userId: string): Promise<number> {
    const result = await this.transactions
      .current()
      .query(`delete from oidc_payloads where user_id = $1`, [userId]);
    return result.rowCount ?? 0;
  }
}
