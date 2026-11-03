/**
 * Conexión IMAP de una fuente de correo: lectura y guardado (ADR 0045, IC-5b-3).
 *
 * Invariantes de seguridad
 * - Dos llaves: `inbound.configure` y EDIT sobre la fuente. Cambiar los destinatarios aceptados exige MANAGE:
 *   quien amplía la lista decide qué correo ajeno entra a la fuente.
 * - Cambiar host, puerto, usuario o modo TLS BORRA la contraseña guardada salvo que se traiga una nueva. Si no,
 *   quien tiene EDIT podría apuntar el worker a un servidor suyo y recibir ahí la contraseña guardada.
 * - Guardar una contraseña exige reautenticación reciente, se cifra solo con el módulo de criptografía y el
 *   búfer en claro se borra. Nunca se devuelve, se registra ni se audita; solo se informa si existe.
 * - Toda escritura de contraseña (nueva o borrada) sube `secret_version`: un recifrado en curso con la versión
 *   anterior choca y no puede resucitar la contraseña vieja.
 * - Ningún destinatario aceptado puede ser el correo de una persona de la organización: la fuente no es una vía
 *   para leer los correos de restablecimiento de alguien.
 * - Todo lo que puede responder con `err` va ANTES de la primera escritura: la unidad de trabajo confirma
 *   cualquier retorno que no lance. Un fallo de cifrado se LANZA para revertir.
 * - Se bloquea la fuente y luego la conexión antes de leer el nivel; la auditoría es el último paso (ADR 0023).
 */
import type {
  MailTlsMode,
  Permission,
  PutInboundSourceConnectionRequest,
  ShareLevel,
} from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import { REAUTH_WINDOW_MS } from '../../access/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { levelSatisfies } from '../../vault/index.js';
import { mailSourcePasswordContext } from '../domain/mail-source-password-context.js';
import type {
  InboundConfigurationRepository,
  SourceRecord,
} from './ports/inbound-configuration-repository.js';
import type {
  InboundSourceConnectionRepository,
  PasswordChange,
  SourceConnectionRecord,
} from './ports/inbound-source-connection-repository.js';

const CONFIGURE_PERMISSION: Permission = 'inbound.configure';
const EDIT_LEVEL: ShareLevel = 'EDIT';
const RECIPIENTS_LEVEL: ShareLevel = 'MANAGE';
const FIRST_SECRET_VERSION = 1;
/** Solo una fuente de correo tiene conexión IMAP; las de SMS llegan por otro adaptador (IC-7). */
const MAIL_CHANNEL = 'mail';

const textEncoder = new TextEncoder();

export interface ManageInboundSourceConnectionDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly configuration: InboundConfigurationRepository;
  readonly connections: InboundSourceConnectionRepository;
  readonly cipher: SecretCipher;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

interface Endpoint {
  readonly host: string;
  readonly port: number;
  readonly tlsMode: MailTlsMode;
  readonly username: string;
}

export class ManageInboundSourceConnection {
  constructor(private readonly deps: ManageInboundSourceConnectionDeps) {}

  /** La conexión de la fuente, o `null` si aún no se configuró. Pide EDIT, como configurarla. */
  get(sourceId: string): Promise<Result<SourceConnectionRecord | null, DomainError>> {
    const { uow, authorizer, configuration, connections } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const actorId = this.requireActorId();

      const source = await configuration.findSource(sourceId);
      if (source === null || source.status === 'archived') return this.denyUnknown(sourceId);
      const level = await this.sourceLevel(source.id, actorId);
      if (!level.ok) return level;
      if (!levelSatisfies(level.value, EDIT_LEVEL)) return this.denyInsufficient(source.id);
      if (source.channel !== MAIL_CHANNEL) return notMailSource();

      return ok(await connections.find(source.id));
    });
  }

  put(
    sourceId: string,
    input: PutInboundSourceConnectionRequest,
  ): Promise<Result<SourceConnectionRecord, DomainError>> {
    const { context, uow, authorizer, configuration, connections, audit } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const current = context.current();
      const actorId = this.requireActorId();

      const source = await configuration.findSourceForUpdate(sourceId);
      if (source === null) return this.denyUnknown(sourceId);
      const existing = await connections.findForUpdate(source.id);
      const level = await this.sourceLevel(source.id, actorId);
      if (!level.ok) return level;
      if (!levelSatisfies(level.value, EDIT_LEVEL)) return this.denyInsufficient(source.id);
      if (source.channel !== MAIL_CHANNEL) return notMailSource();

      const recipients = resolveRecipients(input.acceptedRecipients, existing, source);
      const recipientsChanged = !sameRecipients(
        recipients,
        existing === null ? [source.address] : existing.acceptedRecipients,
      );
      if (recipientsChanged && !levelSatisfies(level.value, RECIPIENTS_LEVEL)) {
        return this.denyInsufficient(source.id);
      }
      if ((await connections.countUserEmails(recipients)) > 0) {
        return err(
          new DomainError(
            'INBOUND.RECIPIENT_NOT_ALLOWED',
            'An accepted recipient is the email of a platform user',
          ),
        );
      }
      if (input.password !== undefined) await this.requireRecentReauth(source.id);

      const endpoint: Endpoint = {
        host: input.host,
        port: input.port,
        tlsMode: input.tlsMode,
        username: input.username,
      };
      const endpointChanged = existing !== null && !sameEndpoint(endpoint, existing);
      const passwordAction: PasswordChange['kind'] =
        input.password !== undefined ? 'set' : endpointChanged ? 'clear' : 'keep';
      const clearsStoredPassword = passwordAction === 'clear' && existing?.hasPassword === true;
      const secretVersion =
        existing === null
          ? FIRST_SECRET_VERSION
          : passwordAction === 'keep'
            ? existing.secretVersion
            : existing.secretVersion + 1;

      const password =
        input.password === undefined
          ? ({ kind: passwordAction === 'clear' ? 'clear' : 'keep' } as const)
          : await this.encryptPassword(source.id, secretVersion, input.password);

      const write = {
        sourceId: source.id,
        ...endpoint,
        authservId: input.authservId,
        acceptedRecipients: recipients,
        password,
        secretVersion,
        createdBy: actorId,
      };
      const saved =
        existing === null ? await connections.insert(write) : await connections.update(write);

      await audit.record({
        action: 'inbound.source_updated',
        actorId,
        targetType: 'mail_source',
        targetId: source.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {
          changedFields: changedConnectionFields(existing, saved, {
            recipientsChanged,
            passwordSet: password.kind === 'set',
            passwordCleared: clearsStoredPassword,
          }).join(','),
        },
      });
      return ok(saved);
    });
  }

  /** Cifra con el contexto de la versión nueva. Un fallo se LANZA: devolver `err` confirmaría lo escrito. */
  private async encryptPassword(
    sourceId: string,
    secretVersion: number,
    plaintext: string,
  ): Promise<PasswordChange> {
    const organizationId = this.deps.context.current().organizationId;
    const bytes = textEncoder.encode(plaintext);
    let encrypted;
    try {
      encrypted = await this.deps.cipher.encrypt(
        mailSourcePasswordContext(organizationId, sourceId, secretVersion),
        bytes,
      );
    } finally {
      bytes.fill(0);
    }
    if (!encrypted.ok) throw encrypted.error;
    return { kind: 'set', encrypted: encrypted.value };
  }

  /**
   * `inbound.configure` no lleva reautenticación en el catálogo; la contraseña sí, y se pide aquí. La negación
   * se audita en una transacción independiente, así que sobrevive a la reversión que provoca el `throw`.
   */
  private async requireRecentReauth(sourceId: string): Promise<void> {
    const reauthAt = this.deps.context.current().reauthAt;
    const now = this.deps.clock.now().getTime();
    if (reauthAt === null || now - reauthAt.getTime() > REAUTH_WINDOW_MS) {
      await this.deps.authorizer.auditDenial({
        code: 'AUTHZ.REAUTH_REQUIRED',
        permission: CONFIGURE_PERMISSION,
        targetSourceId: sourceId,
      });
      throw new DomainError('AUTHZ.REAUTH_REQUIRED', 'Recent re-authentication required');
    }
  }

  /** Sin nivel sobre la fuente se responde como si no existiera (y se audita el intento). */
  private async sourceLevel(
    sourceId: string,
    actorId: UserId,
  ): Promise<Result<ShareLevel, DomainError>> {
    const level = await this.deps.configuration.resourceLevel('mail_source', sourceId, actorId);
    if (level === null) return this.denyUnknown(sourceId);
    return ok(level);
  }

  private async denyUnknown(sourceId: string): Promise<Result<never, DomainError>> {
    await this.auditDenial(sourceId);
    return err(new DomainError('NOT_FOUND', 'Inbound source not found'));
  }

  private async denyInsufficient(sourceId: string): Promise<Result<never, DomainError>> {
    await this.auditDenial(sourceId);
    return err(new DomainError('AUTHZ.SHARE', 'Insufficient access to this inbound source'));
  }

  private async auditDenial(sourceId: string): Promise<void> {
    await this.deps.authorizer.auditDenial({
      code: 'AUTHZ.SHARE',
      permission: CONFIGURE_PERMISSION,
      targetSourceId: sourceId,
    });
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}

/** Una fuente de SMS no tiene conexión IMAP: para esta ruta no existe. No es una negación de acceso. */
function notMailSource(): Result<never, DomainError> {
  return err(new DomainError('NOT_FOUND', 'Inbound source has no mail connection'));
}

/** Sin lista en la petición se conserva la guardada; en una conexión nueva, la dirección de la fuente (ADR 0045). */
function resolveRecipients(
  requested: readonly string[] | undefined,
  existing: SourceConnectionRecord | null,
  source: SourceRecord,
): string[] {
  const base = requested ?? existing?.acceptedRecipients ?? [source.address];
  return [...new Set(base.map((address) => address.toLowerCase()))];
}

function sameRecipients(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((address) => rightSet.has(address));
}

function sameEndpoint(endpoint: Endpoint, existing: SourceConnectionRecord): boolean {
  return (
    endpoint.host === existing.host &&
    endpoint.port === existing.port &&
    endpoint.tlsMode === existing.tlsMode &&
    endpoint.username === existing.username
  );
}

/** Nombres de campo, nunca valores: la auditoría no lleva direcciones, hosts ni usuarios. */
function changedConnectionFields(
  before: SourceConnectionRecord | null,
  after: SourceConnectionRecord,
  flags: {
    readonly recipientsChanged: boolean;
    readonly passwordSet: boolean;
    readonly passwordCleared: boolean;
  },
): string[] {
  const changed: string[] = [];
  if (before === null) changed.push('connection');
  if (before !== null && before.host !== after.host) changed.push('host');
  if (before !== null && before.port !== after.port) changed.push('port');
  if (before !== null && before.tlsMode !== after.tlsMode) changed.push('tlsMode');
  if (before !== null && before.username !== after.username) changed.push('username');
  if (before !== null && before.authservId !== after.authservId) changed.push('authservId');
  if (flags.recipientsChanged) changed.push('acceptedRecipients');
  if (flags.passwordSet) changed.push('password');
  if (flags.passwordCleared) changed.push('passwordCleared');
  return changed;
}
