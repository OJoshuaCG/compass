/**
 * Invariantes de seguridad
 * - Cada método abre su propia transacción corta con la organización de la fuente fijada (aislamiento por
 *   filas); nunca queda una transacción abierta durante la red (ADR 0045, reglas transversales).
 * - Solo escribe columnas que el rol del worker puede actualizar; no guarda secretos ni texto del servidor.
 * - El arrendamiento vence solo: si el proceso muere, otra pasada puede reclamar la fuente.
 * - El dueño del arrendamiento es quien lo reclamó: guardar el cursor o liberar solo surte efecto si el
 *   `claimed_until` sigue siendo el que esta instancia fijó. Una pasada que sobrevivió a su arrendamiento no
 *   puede retroceder el cursor de quien lo tomó después ni liberarle el arrendamiento.
 */
import type { IdGenerator } from '../../../shared/kernel/index.js';
import type { TenantScope, TransactionProvider } from '../../organization/index.js';
import type {
  PollCursor,
  PollStateStore,
  SourceRef,
} from '../application/ports/poll-state-store.js';

interface PollStateRow {
  uid_validity: string | null;
  last_uid: string;
  consecutive_failures: number;
}

export class PgPollStateStore implements PollStateStore {
  /**
   * `claimed_until` que esta instancia fijó por fuente. Se compara en cada escritura posterior; sin
   * entrada (nunca reclamó, o ya liberó) no hay arrendamiento propio y la escritura no se hace.
   */
  private readonly ownedLeases = new Map<string, Date>();

  constructor(
    private readonly scope: TenantScope,
    private readonly transactions: TransactionProvider,
    private readonly ids: IdGenerator,
  ) {}

  claim(source: SourceRef, now: Date, leaseMs: number): Promise<PollCursor | null> {
    return this.inSource(source, async () => {
      const leaseUntil = new Date(now.getTime() + leaseMs);
      // Una fuente nueva todavía no tiene fila de estado: se crea vacía y después se reclama. Su primer intento
      // es `now` (el reloj del llamador), no el `now()` de la base: así el reloj inyectado manda sobre la elegibilidad.
      await this.transactions.current().query(
        `insert into mail_source_poll_state (organization_id, source_id, next_attempt_at)
         values ($1, $2, $3)
         on conflict (organization_id, source_id) do nothing`,
        [source.organizationId, source.sourceId, now],
      );
      // La condición del UPDATE es la exclusión mutua: solo una pasada ve la fila libre o vencida.
      const claimed = await this.transactions.current().query<PollStateRow>(
        `update mail_source_poll_state
            set claimed_until = $3
          where organization_id = $1
            and source_id = $2
            and (claimed_until is null or claimed_until < $4)
            and next_attempt_at <= $4
        returning uid_validity, last_uid, consecutive_failures`,
        [source.organizationId, source.sourceId, leaseUntil, now],
      );
      const row = claimed.rows[0];
      if (row === undefined) return null;
      this.ownedLeases.set(leaseKey(source), leaseUntil);
      // `bigint` llega como texto desde el controlador: UIDVALIDITY y UID caben en 32 bits sin signo.
      return {
        uidValidity: row.uid_validity === null ? null : Number(row.uid_validity),
        lastUid: Number(row.last_uid),
        consecutiveFailures: row.consecutive_failures,
      };
    });
  }

  saveCursor(
    source: SourceRef,
    cursor: { readonly uidValidity: number; readonly lastUid: number },
  ): Promise<void> {
    const ownedLease = this.ownedLeases.get(leaseKey(source));
    // Sin arrendamiento propio no se escribe: el cursor es de quien tenga la fuente ahora.
    if (ownedLease === undefined) return Promise.resolve();
    return this.inSource(source, async () => {
      await this.transactions.current().query(
        `update mail_source_poll_state
            set uid_validity = $3, last_uid = $4
          where organization_id = $1 and source_id = $2 and claimed_until = $5`,
        [source.organizationId, source.sourceId, cursor.uidValidity, cursor.lastUid, ownedLease],
      );
    });
  }

  releaseAfterSuccess(source: SourceRef, now: Date): Promise<void> {
    const ownedLease = this.takeOwnedLease(source);
    if (ownedLease === undefined) return Promise.resolve();
    return this.inSource(source, async () => {
      await this.transactions.current().query(
        `update mail_source_poll_state
            set claimed_until = null,
                consecutive_failures = 0,
                last_error_code = null,
                last_polled_at = $3,
                next_attempt_at = $3
          where organization_id = $1 and source_id = $2 and claimed_until = $4`,
        [source.organizationId, source.sourceId, now, ownedLease],
      );
    });
  }

  releaseAfterFailure(
    source: SourceRef,
    failure: { readonly errorCode: string; readonly nextAttemptAt: Date },
    now: Date,
  ): Promise<void> {
    const ownedLease = this.takeOwnedLease(source);
    if (ownedLease === undefined) return Promise.resolve();
    return this.inSource(source, async () => {
      await this.transactions.current().query(
        `update mail_source_poll_state
            set claimed_until = null,
                consecutive_failures = consecutive_failures + 1,
                last_error_code = $3,
                last_polled_at = $5,
                next_attempt_at = $4
          where organization_id = $1 and source_id = $2 and claimed_until = $6`,
        [
          source.organizationId,
          source.sourceId,
          failure.errorCode,
          failure.nextAttemptAt,
          now,
          ownedLease,
        ],
      );
    });
  }

  /** Devuelve el arrendamiento propio y lo olvida: tras liberar ya no hay nada que defender. */
  private takeOwnedLease(source: SourceRef): Date | undefined {
    const key = leaseKey(source);
    const ownedLease = this.ownedLeases.get(key);
    this.ownedLeases.delete(key);
    return ownedLease;
  }

  private inSource<T>(source: SourceRef, work: () => Promise<T>): Promise<T> {
    return this.scope.runAs(
      { organizationId: source.organizationId, actorId: null, requestId: this.ids.next() },
      work,
    );
  }
}

function leaseKey(source: SourceRef): string {
  return `${source.organizationId}:${source.sourceId}`;
}
