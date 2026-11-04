/**
 * Adaptador de rotación para las bajas (governance §2.4).
 *
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización.
 * - Solo lee ids y escribe tareas; nunca toca secretos ni versiones de credenciales.
 * - La deduplicación es por consulta (pendiente o en curso con el mismo disparador); es segura porque la
 *   baja corre bajo el bloqueo de jerarquía de la organización.
 */
import type {
  LiveCredentialRef,
  NewOffboardingRotationTask,
  OffboardingRotationStore,
} from '../../directory/index.js';
import type { TransactionProvider } from '../../organization/index.js';

const ROTATION_TRIGGER_USER_DEACTIVATED = 'user_deactivated';

export class PgOffboardingRotationStore implements OffboardingRotationStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async listLiveCredentials(accountIds: readonly string[]): Promise<readonly LiveCredentialRef[]> {
    if (accountIds.length === 0) return [];
    const result = await this.transactions.current().query<{ id: string; account_id: string }>(
      `select c.id, c.account_id
         from credentials c
        where c.account_id = any($1::uuid[])
          and c.archived_at is null
        order by c.id`,
      [[...accountIds]],
    );
    return result.rows.map((row) => ({ credentialId: row.id, accountId: row.account_id }));
  }

  async listRevealedCredentialIds(input: {
    readonly userId: string;
    readonly credentialIds: readonly string[];
  }): Promise<readonly string[]> {
    if (input.credentialIds.length === 0) return [];
    const result = await this.transactions.current().query<{ credential_id: string }>(
      `select distinct ae.target_id as credential_id
         from audit_events ae
        where ae.action = 'credential.revealed'
          and ae.outcome = 'success'
          and ae.target_type = 'credential'
          and ae.actor_id = $1
          and ae.target_id = any($2::uuid[])
        order by ae.target_id`,
      [input.userId, [...input.credentialIds]],
    );
    return result.rows.map((row) => row.credential_id);
  }

  async createTasks(tasks: readonly NewOffboardingRotationTask[]): Promise<number> {
    const queryable = this.transactions.current();
    let covered = 0;
    for (const task of tasks) {
      // Una tarea abierta de una baja anterior NO se descarta: se endurece. El plazo nunca se alarga, la
      // prioridad nunca baja, y la persona asignada solo cambia si la actual ya no está activa (o es quien
      // se va ahora); así la credencial no queda en manos de alguien que ya no puede rotarla.
      const refreshed = await queryable.query(
        `update rotation_tasks
            set assigned_to = case
                  when exists (
                         select 1 from users current_assignee
                          where current_assignee.id = rotation_tasks.assigned_to
                            and current_assignee.status = 'active'
                            and current_assignee.id <> $3)
                  then rotation_tasks.assigned_to
                  else $4 end,
                due_at = least(rotation_tasks.due_at, $6),
                priority = case
                  when rotation_tasks.priority = 'high' or $5 = 'high' then 'high'
                  else rotation_tasks.priority end,
                updated_at = now()
          where credential_id = $1 and trigger = $2 and status in ('pending', 'in_progress')`,
        [
          task.credentialId,
          ROTATION_TRIGGER_USER_DEACTIVATED,
          task.triggeredBy,
          task.assignedTo,
          task.priority,
          task.dueAt,
        ],
      );
      if ((refreshed.rowCount ?? 0) > 0) {
        covered += 1;
        continue;
      }
      await queryable.query(
        `insert into rotation_tasks
           (organization_id, credential_id, trigger, triggered_by_user, assigned_to, priority, due_at)
         values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3, $4, $5, $6)`,
        [
          task.credentialId,
          ROTATION_TRIGGER_USER_DEACTIVATED,
          task.triggeredBy,
          task.assignedTo,
          task.priority,
          task.dueAt,
        ],
      );
      covered += 1;
    }
    return covered;
  }
}
