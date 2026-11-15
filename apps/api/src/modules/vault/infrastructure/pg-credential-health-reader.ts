/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita cada tabla a la organización.
 * - No lee `credential_secrets` ni el HMAC hacia el servidor: la reutilización se cuenta dentro de SQL.
 * - Las consultas llevan parámetros enlazados.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { CredentialHealthReader } from '../application/ports/credential-health-reader.js';
import type { CredentialHealthFacts, CredentialTotpState } from '../domain/credential-health.js';

interface HealthFactsRow {
  credential_id: string;
  strength_score: number | null;
  reused_by_others: string;
  last_changed_at: Date;
  platform_supports_totp: boolean;
  totp_state: CredentialTotpState | null;
  totp_exposed: boolean;
  has_open_rotation_task: boolean;
}

export class PgCredentialHealthReader implements CredentialHealthReader {
  constructor(private readonly transactions: TransactionProvider) {}

  async factsByAccount(accountId: string): Promise<readonly CredentialHealthFacts[]> {
    const result = await this.transactions.current().query<HealthFactsRow>(
      `select c.id as credential_id,
              pf.strength_score,
              (select count(*)
                 from password_fingerprints other_pf
                 join credentials other_c
                   on other_c.organization_id = other_pf.organization_id
                  and other_c.id = other_pf.credential_id
                where other_pf.hmac = pf.hmac
                  and other_pf.credential_id <> c.id
                  and other_c.archived_at is null) as reused_by_others,
              coalesce(c.last_rotated_at, c.created_at) as last_changed_at,
              p.supports_totp as platform_supports_totp,
              t.status as totp_state,
              (t.exposed_at is not null) as totp_exposed,
              exists (select 1
                        from rotation_tasks r
                       where r.credential_id = c.id
                         and r.status in ('pending', 'in_progress')) as has_open_rotation_task
         from credentials c
         join accounts a on a.organization_id = c.organization_id and a.id = c.account_id
         join platforms p on p.id = a.platform_id
         left join password_fingerprints pf
                on pf.organization_id = c.organization_id and pf.credential_id = c.id
         left join credential_totp t
                on t.organization_id = c.organization_id and t.credential_id = c.id
        where c.account_id = $1 and c.archived_at is null
        order by lower(c.label), c.id`,
      [accountId],
    );
    return result.rows.map((row) => ({
      credentialId: row.credential_id,
      strengthScore: row.strength_score,
      reusedByOtherCredentials: Number(row.reused_by_others),
      lastChangedAt: row.last_changed_at,
      platformSupportsTotp: row.platform_supports_totp,
      totpState: row.totp_state,
      totpExposed: row.totp_exposed,
      hasOpenRotationTask: row.has_open_rotation_task,
    }));
  }
}
