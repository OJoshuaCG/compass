/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: el aislamiento por filas limita lectura y escritura a la
 *   organización fijada en `app.org_id`, que es también la organización que se inserta.
 * - Escritura optimista: solo cambia la fila si su versión sigue siendo la leída, así dos personas que
 *   guardan a la vez no se pisan en silencio.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  AlertSettingsStore,
  SaveAlertSettingsInput,
} from '../application/ports/alert-settings-store.js';
import { DEFAULT_INFRASTRUCTURE_ALERT_CHANNELS } from '../domain/alert-settings.js';
import type { AlertSettingsRecord } from '../domain/alert-settings.js';

/** Versión que informa el almacén cuando la organización todavía no guardó ningún ajuste. */
const NO_ROW_VERSION = 0;

interface AlertSettingsRow {
  infra_email: boolean;
  infra_telegram: boolean;
  updated_by: string;
  updated_at: Date;
  version: number;
}

const RETURNED_COLUMNS = 'infra_email, infra_telegram, updated_by, updated_at, version';

const toRecord = (row: AlertSettingsRow): AlertSettingsRecord => ({
  infrastructure: { email: row.infra_email, telegram: row.infra_telegram },
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
  version: row.version,
});

export class PgAlertSettingsStore implements AlertSettingsStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async find(): Promise<AlertSettingsRecord> {
    const result = await this.transactions
      .current()
      .query<AlertSettingsRow>(`select ${RETURNED_COLUMNS} from alert_settings limit 1`);
    const row = result.rows[0];
    if (row === undefined) {
      return {
        infrastructure: DEFAULT_INFRASTRUCTURE_ALERT_CHANNELS,
        updatedBy: null,
        updatedAt: null,
        version: NO_ROW_VERSION,
      };
    }
    return toRecord(row);
  }

  async save(input: SaveAlertSettingsInput): Promise<AlertSettingsRecord | null> {
    const transaction = this.transactions.current();
    if (input.expectedVersion === NO_ROW_VERSION) {
      // Primera escritura. Si otra persona insertó entretanto, el conflicto no inserta nada y se informa.
      const inserted = await transaction.query<AlertSettingsRow>(
        `insert into alert_settings (organization_id, infra_email, infra_telegram, updated_by)
         values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3)
         on conflict (organization_id) do nothing
         returning ${RETURNED_COLUMNS}`,
        [input.infrastructure.email, input.infrastructure.telegram, input.updatedBy],
      );
      const insertedRow = inserted.rows[0];
      return insertedRow === undefined ? null : toRecord(insertedRow);
    }
    const updated = await transaction.query<AlertSettingsRow>(
      `update alert_settings
          set infra_email = $1,
              infra_telegram = $2,
              updated_by = $3,
              version = version + 1
        where version = $4
       returning ${RETURNED_COLUMNS}`,
      [
        input.infrastructure.email,
        input.infrastructure.telegram,
        input.updatedBy,
        input.expectedVersion,
      ],
    );
    const updatedRow = updated.rows[0];
    return updatedRow === undefined ? null : toRecord(updatedRow);
  }
}
