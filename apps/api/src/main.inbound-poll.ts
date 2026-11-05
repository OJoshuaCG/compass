/**
 * Una pasada del sondeo de correo entrante por IMAP (ADR 0045). Se programa desde el cron del anfitrión
 * (propuesta: cada minuto; ver `docs/runbooks/inbound-poll.md`); no es un servicio en escucha.
 *
 * Usa el rol `iam_inbound_worker` (sin BYPASSRLS) y su configuración propia. Imprime solo conteos y una
 * línea JSON por mensaje sin contenido. Código de salida: 0 con pasada completa (aunque algunas fuentes
 * hayan fallado: su backoff ya quedó anotado), 1 si la configuración, la base o un defecto impidieron
 * sondear bien.
 */
import { lookup } from 'node:dns/promises';

import { Pool } from 'pg';

import { loadInboundPollConfig } from './app/inbound-poll-config.js';
import { createKeyManagement } from './app/key-management.js';
import {
  DataKeyResolver,
  DekCache,
  NodeCryptoPrimitives,
  SecretCipher,
} from './modules/crypto/index.js';
import {
  AuthenticationResultsVerifier,
  ImapFlowMailboxConnector,
  LogPollObserver,
  ChildProcessMimeParser,
  NetworkGuard,
  PgInboundRecorder,
  PgMailConnectionLoader,
  PgPollableSourceLister,
  PgPollStateStore,
  PgSourceTemplateStore,
  PollInboundSources,
  PollMailSource,
  ReadOnlyDataKeyRepository,
  Sha256MessageFingerprinter,
} from './modules/inbound-codes/index.js';
import { PgTenantScope, PgUnitOfWork } from './modules/organization/index.js';
import { AsyncLocalRequestContext } from './shared/infrastructure/async-local-request-context.js';
import { SystemClock } from './shared/infrastructure/system-clock.js';
import { UuidV7Generator } from './shared/infrastructure/uuid-v7-generator.js';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Un error de una conexión inactiva del pool se emite como evento; sin escucha, Node lo trata como excepción
 * no capturada e imprime la traza (con datos de conexión) fuera del control de salida de este proceso.
 */
const ignorePoolError = (): void => undefined;

async function closeQuietly(close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch {
    // Cerrar es lo último que se hace: un fallo aquí no debe tapar el resultado ni impedir el cierre siguiente.
  }
}

let pool: Pool | undefined;
let independentPool: Pool | undefined;
let keys: DataKeyResolver | undefined;

try {
  // Dentro del `try` para que una configuración inválida, el archivo de claves o el KMS salgan por el mismo
  // camino controlado: mensaje de una línea y código 1, nunca una traza.
  const config = loadInboundPollConfig(process.env);
  pool = new Pool({ connectionString: config.DATABASE_URL_INBOUND_WORKER, max: 3 });
  independentPool = new Pool({ connectionString: config.DATABASE_URL_INBOUND_WORKER, max: 1 });
  pool.on('error', ignorePoolError);
  independentPool.on('error', ignorePoolError);

  const clock = new SystemClock();
  const ids = new UuidV7Generator();
  const requestContext = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(pool, requestContext, independentPool);
  const scope = new PgTenantScope(requestContext, uow);
  keys = new DataKeyResolver({
    // El worker nunca crea una DEK: si no hay una activa, falla antes de llegar al KMS.
    repository: new ReadOnlyDataKeyRepository(uow),
    kms: createKeyManagement(config),
    cache: new DekCache({ clock }),
    clock,
    independently: <T>(fn: () => Promise<T>): Promise<T> => uow.runIndependent(fn),
  });
  const cipher = new SecretCipher({ keys, primitives: new NodeCryptoPrimitives() });
  const networkGuard = new NetworkGuard(async (host) => {
    const records = await lookup(host, { all: true });
    return records.map((record) => record.address);
  }, config.INBOUND_POLL_ALLOWED_PRIVATE_NETWORKS);

  const pollSource = new PollMailSource({
    state: new PgPollStateStore(scope, uow, ids),
    connections: new PgMailConnectionLoader(scope, uow, cipher, ids),
    templates: new PgSourceTemplateStore(scope, uow, ids),
    mailbox: new ImapFlowMailboxConnector(networkGuard),
    mime: new ChildProcessMimeParser(),
    authenticity: new AuthenticationResultsVerifier(),
    fingerprints: new Sha256MessageFingerprinter(),
    recorder: new PgInboundRecorder(scope, uow, cipher, ids),
    clock,
    observer: new LogPollObserver((line) => process.stdout.write(`${line}\n`)),
  });

  const summary = await new PollInboundSources({
    lister: new PgPollableSourceLister(pool),
    poller: pollSource,
    clock,
    settings: {
      maxSourcesPerRun: config.INBOUND_POLL_MAX_SOURCES_PER_RUN,
      runBudgetMs: config.INBOUND_POLL_RUN_BUDGET_SECONDS * MILLISECONDS_PER_SECOND,
    },
  }).execute();

  process.stdout.write(
    `Fuentes listadas: ${String(summary.listed)}; intentadas: ${String(summary.attempted)}; completas: ${String(summary.completed)}; con arrendamiento ajeno: ${String(summary.skippedLeased)}; fallidas: ${String(summary.failed)}; diferidas: ${String(summary.deferred)}; códigos aceptados: ${String(summary.accepted)}; en cuarentena: ${String(summary.quarantined)}\n`,
  );
  for (const [code, count] of Object.entries(summary.failedByCode)) {
    process.stderr.write(`Fallo ${code}: ${String(count)}\n`);
  }
  // Un defecto o el KMS caído afectan a todas las fuentes: se hacen visibles por el código de salida.
  if (summary.unexpected > 0) process.exitCode = 1;
} catch (error) {
  // La validación de la configuración solo nombra claves y tipos de falla, nunca valores: es seguro mostrarla.
  // Cualquier otro mensaje podría arrastrar conexión, rutas o texto del servidor.
  const isConfigurationError =
    error instanceof Error && error.message.startsWith('Invalid configuration:');
  process.stderr.write(
    isConfigurationError
      ? `${error.message}\n`
      : 'El sondeo de correo entrante falló antes de terminar la pasada\n',
  );
  process.exitCode = 1;
} finally {
  // Las DEK en memoria se borran también si el trabajo lanzó una excepción.
  keys?.clearCache();
  const poolsToClose = [pool, independentPool];
  for (const poolToClose of poolsToClose) {
    if (poolToClose !== undefined) await closeQuietly(() => poolToClose.end());
  }
}
