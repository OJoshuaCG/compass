/**
 * Credenciales de las cuentas de la bóveda: crear, cambiar la contraseña (con versiones y huella),
 * historial sin contenido, copiar el usuario y revelar la contraseña.
 *
 * Invariantes de seguridad
 * - Dos llaves, como en las cuentas: el permiso del catálogo y el nivel de acceso efectivo a la cuenta.
 *   Sin acceso a la cuenta se responde `NOT_FOUND` y con nivel insuficiente, `AUTHZ.SHARE`; las dos
 *   negaciones se auditan (`authz.denied`) en crear, cambiar la contraseña, historial, copiar y revelar.
 *   El inventario (`vault.inventory.read`) no concede ningún nivel: no revela, no copia, no ve el historial.
 * - Solo el módulo de criptografía cifra y descifra. Aquí el texto en claro vive dentro de una llamada y
 *   se borra de memoria al terminar; nunca se registra, se audita ni viaja en un error.
 * - El historial devuelve versión, fecha y autor: ningún campo con contenido.
 * - Revelar exige reautenticación vigente (la decide el motor), un motivo escrito de 6 a 500 caracteres y
 *   no superar 30 revelaciones exitosas por persona en una hora móvil. El conteo sale de la auditoría
 *   (ADR 0031) y se protege con un bloqueo por persona que se toma ANTES que el de auditoría (ADR 0023).
 * - Todo cambio escribe su auditoría en la misma transacción, como último paso. Las negaciones también.
 */
import {
  REVEAL_LIMIT_PER_HOUR,
  REVEAL_REASON_MAX_LENGTH,
  REVEAL_REASON_MIN_LENGTH,
  isValidRevealReason,
} from '@iam/contracts';
import type { Permission, ShareLevel } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type {
  Clock,
  IdGenerator,
  RequestContextReader,
  Result,
  UserId,
} from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditEventCounter, AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { levelSatisfies } from '../domain/share-level.js';
import type { AccountRepository } from './ports/account-repository.js';
import type {
  CredentialRecord,
  CredentialRepository,
  PasswordVersionSummary,
  SecretField,
} from './ports/credential-repository.js';

export interface ManageCredentialsDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly accounts: AccountRepository;
  readonly credentials: CredentialRepository;
  readonly cipher: SecretCipher;
  readonly audit: AuditLog;
  /** Cuenta los eventos de auditoría: es la fuente única del límite de revelaciones. */
  readonly auditCounter: AuditEventCounter;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface CreateCredentialInput {
  readonly label: string;
  readonly username: string;
  readonly password: string;
}

/** Ventana móvil del límite de revelaciones. */
const REVEAL_WINDOW_MS = 60 * 60 * 1000;
const MILLISECONDS_PER_SECOND = 1000;

const FIRST_VERSION = 1;

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Credential not found');

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ManageCredentials {
  constructor(private readonly deps: ManageCredentialsDeps) {}

  /** Credenciales de una cuenta. Basta con cualquier nivel de acceso: con USE se elige a cuál recurrir. */
  listForAccount(accountId: string): Promise<Result<readonly CredentialRecord[], DomainError>> {
    const { uow, authorizer, accounts, credentials } = this.deps;
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      const level = await accounts.effectiveLevel(accountId, actor.id);
      if (level === null) return err(notFound());
      return ok(await credentials.listByAccount(accountId));
    });
  }

  create(
    accountId: string,
    input: CreateCredentialInput,
  ): Promise<Result<CredentialRecord, DomainError>> {
    const { context, uow, authorizer, accounts, credentials, audit, ids } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'credential.create' });
      const current = context.current();
      const actorId = this.requireActorId();

      // Se bloquea la cuenta antes de leer el nivel, igual que al editarla: un archivado o una
      // revocación ya confirmados se ven en el nivel.
      const account = await accounts.findByIdForUpdate(accountId);
      if (account === null) return err(notFound());
      const level = await this.levelOrNotFound(account.id, actorId, 'credential.create', 'EDIT');
      if (!level.ok) return level;
      if (account.status === 'archived') {
        return err(new DomainError('ACCOUNT.ARCHIVED', 'Account is archived'));
      }

      const credential = await credentials.insertCredential({
        id: ids.next(),
        accountId: account.id,
        label: input.label.trim(),
        kind: 'password',
        createdBy: actorId,
      });

      await this.storeSecret({
        credentialId: credential.id,
        field: 'username',
        version: FIRST_VERSION,
        plaintext: input.username,
        blindIndexPurpose: 'platform-username',
        createdBy: actorId,
      });
      await this.storeSecret({
        credentialId: credential.id,
        field: 'password',
        version: FIRST_VERSION,
        plaintext: input.password,
        blindIndexPurpose: null,
        createdBy: actorId,
      });

      await audit.record({
        action: 'credential.created',
        actorId,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { kind: credential.kind },
      });
      return ok(credential);
    });
  }

  /** Crea una versión nueva de la contraseña; la anterior se conserva en el historial. */
  changePassword(
    credentialId: string,
    password: string,
  ): Promise<Result<CredentialRecord, DomainError>> {
    const { context, uow, authorizer, credentials, audit, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'credential.update' });
      const current = context.current();
      const actorId = this.requireActorId();

      // Bloquear la credencial serializa los cambios de contraseña: la numeración de versiones no se pisa.
      const lockedCredential = await credentials.findByIdForUpdate(credentialId);
      const credential = await this.liveOrNull(lockedCredential);
      if (credential === null) return err(notFound());
      const level = await this.levelOrNotFound(
        credential.accountId,
        actorId,
        'credential.update',
        'EDIT',
      );
      if (!level.ok) return level;

      const previous = await credentials.currentSecret(credential.id, 'password');
      const nextVersion = (previous?.version ?? 0) + FIRST_VERSION;
      if (previous !== null) await credentials.retireCurrentSecret(credential.id, 'password');
      await this.storeSecret({
        credentialId: credential.id,
        field: 'password',
        version: nextVersion,
        plaintext: password,
        blindIndexPurpose: null,
        createdBy: actorId,
      });
      await credentials.markRotated(credential.id, clock.now());
      const updated = await credentials.findById(credential.id);

      await audit.record({
        action: 'credential.password_changed',
        actorId,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { version: nextVersion },
      });
      return ok(updated ?? credential);
    });
  }

  /** Versiones, fechas y autor de la contraseña. Nunca devuelve contenido. Exige EDIT. */
  history(credentialId: string): Promise<Result<readonly PasswordVersionSummary[], DomainError>> {
    const { uow, authorizer, credentials } = this.deps;
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      const credential = await this.liveOrNull(await credentials.findById(credentialId));
      if (credential === null) return err(notFound());
      const level = await this.levelOrNotFound(
        credential.accountId,
        actor.id,
        'credential.update',
        'EDIT',
      );
      if (!level.ok) return level;
      return ok(await credentials.passwordHistory(credential.id));
    });
  }

  /** Entrega el usuario para copiarlo. Exige USE y deja auditoría ligera en cada solicitud. */
  copyUsername(credentialId: string): Promise<Result<string, DomainError>> {
    const { context, uow, authorizer, credentials, audit } = this.deps;
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      const current = context.current();
      const credential = await this.liveOrNull(await credentials.findById(credentialId));
      if (credential === null) return err(notFound());
      const level = await this.levelOrNotFound(
        credential.accountId,
        actor.id,
        'credential.update',
        'USE',
      );
      if (!level.ok) return level;

      const username = await this.openSecret(credential, 'username');
      if (!username.ok) return username;

      await audit.record({
        action: 'credential.username_copied',
        actorId: actor.id,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {},
      });
      return username;
    });
  }

  /**
   * Revela la contraseña vigente. El orden importa: primero lo que no cuesta nada (permiso y
   * reautenticación, acceso a la cuenta, motivo), después el bloqueo por persona, el conteo y, solo al
   * final, el descifrado. Ninguna negación descifra nada.
   */
  revealPassword(
    credentialId: string,
    reason: string | undefined,
  ): Promise<Result<string, DomainError>> {
    const { context, uow, authorizer, accounts, credentials, audit, auditCounter, clock } =
      this.deps;
    const permission: Permission = 'credential.reveal_password';
    return uow.run(async () => {
      // Permiso y reautenticación de 5 minutos: la decisión es del motor de autorización.
      await authorizer.require({ permission });
      const current = context.current();
      const actorId = this.requireActorId();

      const credential = await this.liveOrNull(await credentials.findById(credentialId));
      if (credential === null) return err(notFound());
      const level = await accounts.effectiveLevel(credential.accountId, actorId);
      if (level === null) {
        // Se responde igual que si no existiera, pero un intento de revelar sin acceso es una señal
        // de abuso: queda auditado.
        await authorizer.auditDenial({
          code: 'AUTHZ.SHARE',
          permission,
          targetAccountId: credential.accountId,
        });
        return err(notFound());
      }
      if (!levelSatisfies(level, 'VIEW')) {
        await authorizer.auditDenial({
          code: 'AUTHZ.SHARE',
          permission,
          targetAccountId: credential.accountId,
        });
        return err(new DomainError('AUTHZ.SHARE', 'Insufficient access to this account'));
      }

      if (!isValidRevealReason(reason)) {
        await authorizer.auditDenial({
          code: 'CREDENTIAL.REASON_INVALID',
          permission,
          targetAccountId: credential.accountId,
        });
        return err(
          new DomainError('CREDENTIAL.REASON_INVALID', 'A written reason is required', {
            minLength: REVEAL_MIN_LENGTH,
            maxLength: REVEAL_MAX_LENGTH,
          }),
        );
      }

      // Sin este bloqueo, dos revelaciones concurrentes verían las dos "29 de 30" y pasarían ambas.
      await credentials.lockRevealsOf(actorId);
      const since = new Date(clock.now().getTime() - REVEAL_WINDOW_MS);
      const revealedInWindow = await auditCounter.count({
        actorId,
        action: 'credential.revealed',
        outcome: 'success',
        since,
      });
      if (revealedInWindow >= REVEAL_LIMIT_PER_HOUR) {
        return err(
          await this.denyRevealLimit(credential, actorId, since, permission, revealedInWindow),
        );
      }

      const password = await this.openSecret(credential, 'password');
      if (!password.ok) {
        await audit.record({
          action: 'credential.revealed',
          actorId,
          targetType: 'credential',
          targetId: credential.id,
          outcome: 'failure',
          reasonCode: password.error.code,
          ip: null,
          requestId: current.requestId,
          metadata: {},
        });
        return password;
      }

      await audit.record({
        action: 'credential.revealed',
        actorId,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { reason: reason.trim() },
      });
      return password;
    });
  }

  /**
   * Superar el tope: la negación se audita (agrupada, ADR 0039) y, la primera vez dentro de la ventana,
   * se deja el evento crítico y el aviso pendiente para la Raíz. Repetir el intento no vuelve a avisar.
   */
  private async denyRevealLimit(
    credential: CredentialRecord,
    actorId: UserId,
    since: Date,
    permission: Permission,
    revealedInWindow: number,
  ): Promise<DomainError> {
    const { context, authorizer, credentials, audit, auditCounter, clock } = this.deps;
    await authorizer.auditDenial({
      code: 'CREDENTIAL.REVEAL_LIMIT',
      permission,
      targetAccountId: credential.accountId,
    });
    const alreadyFlagged = await auditCounter.count({
      actorId,
      action: 'credential.reveal_limit_exceeded',
      outcome: 'denied',
      since,
    });
    if (alreadyFlagged === 0) {
      // Misma transacción que la negación y su auditoría (ADR 0035). El payload no lleva secretos ni
      // nombres de credenciales: solo el id de la persona, el tope, el conteo y la ventana.
      await credentials.enqueueRevealLimitNotice({
        actorId,
        limitPerHour: REVEAL_LIMIT_PER_HOUR,
        revealedInWindow,
        windowSeconds: REVEAL_WINDOW_MS / MILLISECONDS_PER_SECOND,
        raisedAt: clock.now(),
      });
      await audit.record({
        action: 'credential.reveal_limit_exceeded',
        actorId,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'denied',
        reasonCode: 'CREDENTIAL.REVEAL_LIMIT',
        ip: null,
        requestId: context.current().requestId,
        metadata: { limit: REVEAL_LIMIT_PER_HOUR },
      });
    }
    return new DomainError('CREDENTIAL.REVEAL_LIMIT', 'Reveal limit reached for this hour');
  }

  /**
   * Cifra un campo, lo guarda y, según el campo, su índice ciego (usuario) o su huella (contraseña).
   * Si la criptografía falla LANZA el error en vez de devolverlo: la unidad de trabajo solo revierte
   * ante una excepción, y devolver un `err` confirmaría una credencial a medias o una contraseña
   * retirada sin versión nueva ni auditoría.
   */
  private async storeSecret(input: {
    readonly credentialId: string;
    readonly field: SecretField;
    readonly version: number;
    readonly plaintext: string;
    /** Solo el usuario se busca por valor exacto; la contraseña guarda su huella, no un índice. */
    readonly blindIndexPurpose: 'platform-username' | null;
    readonly createdBy: UserId;
  }): Promise<void> {
    const { context, credentials, cipher, ids } = this.deps;
    const organizationId = context.current().organizationId;

    const bytes = textEncoder.encode(input.plaintext);
    let encrypted;
    try {
      encrypted = await cipher.encrypt(
        {
          organizationId,
          resourceId: input.credentialId,
          field: input.field,
          version: input.version,
        },
        bytes,
      );
    } finally {
      bytes.fill(0);
    }
    if (!encrypted.ok) throw encrypted.error;

    // El índice y la huella se calculan con la MISMA versión de DEK del texto cifrado: al rotar la
    // clave se recalculan juntos (ADR 0040).
    const dekVersion = encrypted.value.dekVersion;
    let blindIndexHex: string | null = null;
    if (input.blindIndexPurpose !== null) {
      const blind = await cipher.blindIndex(
        organizationId,
        input.blindIndexPurpose,
        input.plaintext,
        dekVersion,
      );
      if (!blind.ok) throw blind.error;
      blindIndexHex = blind.value.index;
    }

    await credentials.insertSecret({
      id: ids.next(),
      credentialId: input.credentialId,
      field: input.field,
      version: input.version,
      ciphertext: encrypted.value.ciphertext,
      nonce: encrypted.value.nonce,
      dekVersion,
      blindIndexHex,
      createdBy: input.createdBy,
    });

    if (input.field === 'password') {
      const fingerprint = await cipher.blindIndex(
        organizationId,
        'password-fingerprint',
        input.plaintext,
        dekVersion,
      );
      if (!fingerprint.ok) throw fingerprint.error;
      await credentials.upsertPasswordFingerprint(input.credentialId, fingerprint.value.index);
    }
  }

  /** Descifra la versión vigente de un campo. El texto en claro sale como cadena; los bytes se borran. */
  private async openSecret(
    credential: CredentialRecord,
    field: SecretField,
  ): Promise<Result<string, DomainError>> {
    const { context, credentials, cipher } = this.deps;
    const secret = await credentials.currentSecret(credential.id, field);
    if (secret === null) return err(notFound());
    const opened = await cipher.decrypt(
      {
        organizationId: context.current().organizationId,
        resourceId: credential.id,
        field,
        version: secret.version,
      },
      { ciphertext: secret.ciphertext, nonce: secret.nonce, dekVersion: secret.dekVersion },
    );
    if (!opened.ok) return err(opened.error);
    try {
      return ok(textDecoder.decode(opened.value));
    } finally {
      opened.value.fill(0);
    }
  }

  /**
   * Segunda llave: el nivel de acceso a la cuenta. Sin acceso se responde igual que si no existiera,
   * pero el intento se audita (igual que al revelar y en el segundo factor: apuntar a una credencial
   * ajena es una señal de abuso); con menos nivel del requerido se niega con `AUTHZ.SHARE` y también
   * se audita. Ambas negaciones usan la acción `authz.denied` del motor, sin metadatos nuevos.
   */
  private async levelOrNotFound(
    accountId: string,
    actorId: UserId,
    permission: Permission,
    required: ShareLevel,
  ): Promise<Result<ShareLevel, DomainError>> {
    const { authorizer, accounts } = this.deps;
    const level = await accounts.effectiveLevel(accountId, actorId);
    if (level === null) {
      await authorizer.auditDenial({ code: 'AUTHZ.SHARE', permission, targetAccountId: accountId });
      return err(notFound());
    }
    if (!levelSatisfies(level, required)) {
      await authorizer.auditDenial({ code: 'AUTHZ.SHARE', permission, targetAccountId: accountId });
      return err(new DomainError('AUTHZ.SHARE', 'Insufficient access to this account'));
    }
    return ok(level);
  }

  /** Una credencial archivada, o de una cuenta archivada, se trata como si no existiera. */
  private async liveOrNull(credential: CredentialRecord | null): Promise<CredentialRecord | null> {
    if (credential === null || credential.archivedAt !== null) return null;
    const account = await this.deps.accounts.findById(credential.accountId);
    if (account === null || account.status !== 'active') return null;
    return credential;
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}

const REVEAL_MIN_LENGTH = REVEAL_REASON_MIN_LENGTH;
const REVEAL_MAX_LENGTH = REVEAL_REASON_MAX_LENGTH;
