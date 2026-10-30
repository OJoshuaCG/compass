/**
 * Segundo factor (TOTP) de las credenciales de la bóveda: registrar, confirmar, emitir el código vigente,
 * exportar, re-registrar y retirar.
 *
 * Invariantes de seguridad
 * - Dos llaves, como en el resto de la bóveda: el permiso del catálogo y el nivel de acceso efectivo a la
 *   cuenta. Sin acceso se responde `NOT_FOUND`; con nivel insuficiente, `AUTHZ.SHARE` auditado.
 *   Emitir un código pide USE; registrar, confirmar, re-registrar y retirar piden EDIT; exportar pide MANAGE.
 * - Solo el módulo de criptografía cifra y descifra. El URI en claro vive dentro de una llamada: se descifra,
 *   se usa y se borra; nunca se registra, se audita ni viaja en un error.
 * - Exportar exige reautenticación vigente (la decide el motor), un motivo escrito de 6 a 500 caracteres y
 *   deja una tarea de rotación: desde ese momento el secreto ya no lo conoce solo la bóveda.
 * - Emitir códigos tiene tope por persona y credencial. El conteo sale de la auditoría y se protege con un
 *   bloqueo que se toma ANTES que el de auditoría (ADR 0023).
 * - Confirmar tiene tope de fallos por registro pendiente (credencial y versión del secreto), contados en
 *   memoria como los intentos de ingreso: agotado, ese registro ya no se confirma, ni con el código
 *   correcto, y hay que registrar de nuevo. Los fallos y la negación se auditan, y la respuesta no distingue
 *   códigos casi correctos.
 * - Todo cambio escribe su auditoría en la misma transacción, como último paso. Las negaciones también.
 * - Un secreto nuevo nunca pisa al anterior: la versión previa queda retenida (30 días) como no vigente.
 */
import {
  REVEAL_REASON_MAX_LENGTH,
  REVEAL_REASON_MIN_LENGTH,
  TOTP_CODES_PER_MINUTE,
  TOTP_CONFIRM_MAX_FAILURES,
  TOTP_NEXT_CODE_THRESHOLD_SECONDS,
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
import { parseOtpauthUri } from '../domain/otpauth-uri.js';
import type { TotpParameters } from '../domain/otpauth-uri.js';
import { levelSatisfies } from '../domain/share-level.js';
import { ROTATION_TASK_DUE_DAYS } from './manage-shares.js';
import type { AccountRepository } from './ports/account-repository.js';
import type { CredentialRecord, CredentialRepository } from './ports/credential-repository.js';
import type { TotpConfirmAttemptStore } from './ports/totp-confirm-attempt-store.js';
import type { TotpGenerator } from './ports/totp-generator.js';
import type { TotpRecord, TotpRepository } from './ports/totp-repository.js';

export interface ManageTotpDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly accounts: AccountRepository;
  readonly credentials: CredentialRepository;
  readonly totps: TotpRepository;
  readonly cipher: SecretCipher;
  readonly generator: TotpGenerator;
  readonly audit: AuditLog;
  /** Cuenta los eventos de auditoría: es la fuente única del tope de códigos. */
  readonly auditCounter: AuditEventCounter;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Fallos de confirmación por registro pendiente (en memoria hasta que haya Redis). */
  readonly confirmAttempts: TotpConfirmAttemptStore;
}

export interface IssuedTotpCode {
  readonly code: string;
  readonly expiresIn: number;
  readonly nextCode?: string;
}

export interface ExportedTotpSecret {
  readonly otpauthUri: string;
  readonly secretKey: string;
}

const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Ventana móvil del tope de códigos. */
const CODE_WINDOW_MS = 60 * 1000;

const FIRST_VERSION = 1;
const TOTP_FIELD = 'totp_uri';

/** Pasos de reloj que se toleran a cada lado al confirmar, por desfase entre dispositivos. */
const CONFIRM_STEP_TOLERANCE = 1;

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Credential not found');

const stateInvalid = (): DomainError =>
  new DomainError('CREDENTIAL.TOTP_STATE_INVALID', 'The second factor does not allow this action');

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ManageTotp {
  constructor(private readonly deps: ManageTotpDeps) {}

  /** Metadatos del segundo factor: nunca el secreto. Basta con poder usar la credencial. */
  status(credentialId: string): Promise<Result<TotpRecord, DomainError>> {
    const { uow, authorizer, totps } = this.deps;
    return uow.run(async () => {
      const permission: Permission = 'credential.use_totp';
      await authorizer.require({ permission });
      const actorId = this.requireActorId();

      const credential = await this.liveOrNull(await this.deps.credentials.findById(credentialId));
      if (credential === null) return err(notFound());
      const level = await this.levelOrNotFound(credential, actorId, permission, 'USE');
      if (!level.ok) return level;

      const totp = await totps.find(credential.id);
      return totp === null ? err(notFound()) : ok(totp);
    });
  }

  /**
   * Registra el segundo factor desde un URI otpauth. Si ya había uno, es un re-registro: el secreto anterior
   * queda retenido como versión no vigente y el estado vuelve a `pending` hasta confirmar el código.
   */
  register(credentialId: string, otpauthUri: string): Promise<Result<TotpRecord, DomainError>> {
    const { context, uow, authorizer, credentials, totps, audit, clock } = this.deps;
    const permission: Permission = 'credential.update';
    return uow.run(async () => {
      await authorizer.require({ permission });
      const current = context.current();
      const actorId = this.requireActorId();

      const credential = await this.liveOrNull(await credentials.findByIdForUpdate(credentialId));
      if (credential === null) return err(notFound());
      const level = await this.levelOrNotFound(credential, actorId, permission, 'EDIT');
      if (!level.ok) return level;

      const parsed = parseOtpauthUri(otpauthUri);
      if (!parsed.ok) {
        // El motivo técnico (`problem`) no lleva ningún fragmento del URI; la clave jamás sale en el error.
        return err(
          new DomainError('CREDENTIAL.TOTP_URI_INVALID', 'The otpauth URI is not valid', {
            problem: parsed.problem,
          }),
        );
      }

      // Un secreto con alfabeto válido puede no ser decodificable (longitud o bits finales no canónicos):
      // se prueba antes de retirar el factor vigente, para no dejar la credencial con un factor inservible.
      try {
        this.deps.generator.codeAt(parsed.value.secretBase32, parsed.value, clock.now());
      } catch {
        return err(
          new DomainError('CREDENTIAL.TOTP_URI_INVALID', 'The otpauth URI is not valid', {
            problem: 'secret_invalid',
          }),
        );
      }

      const previous = await credentials.currentSecret(credential.id, TOTP_FIELD);
      // Re-registrar el mismo secreto que se exportó no lo devuelve a "solo la bóveda lo conoce".
      const keepExposure = await this.sameSecretAsCurrent(credential, parsed.value.secretBase32);
      const version = previous === null ? FIRST_VERSION : previous.version + 1;
      if (previous !== null) await credentials.retireCurrentSecret(credential.id, TOTP_FIELD);
      await this.storeUri(credential.id, version, parsed.value.normalizedUri, actorId);

      const registration = {
        credentialId: credential.id,
        secretVersion: version,
        algorithm: parsed.value.algorithm,
        digits: parsed.value.digits,
        periodSeconds: parsed.value.periodSeconds,
        registeredBy: actorId,
        registeredAt: clock.now(),
      };
      const existing = await totps.find(credential.id);
      if (existing === null) {
        await totps.insert(registration);
      } else {
        await totps.replace(registration, keepExposure);
      }
      await totps.markCredentialWithTotp(credential.id);

      const parameters = {
        algorithm: parsed.value.algorithm,
        digits: parsed.value.digits,
        period: parsed.value.periodSeconds,
      };
      await audit.record({
        action: previous === null ? 'credential.totp_registered' : 'credential.totp_reregistered',
        actorId,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata:
          previous === null ? parameters : { ...parameters, previousVersion: previous.version },
      });

      const saved = await totps.find(credential.id);
      if (saved === null) throw new Error('The second factor just stored was not found');
      return ok(saved);
    });
  }

  /**
   * Confirma que el secreto registrado produce los mismos códigos que la plataforma: quien registra
   * escribe el código que ve allá. Solo entonces `pending` pasa a `verified`.
   */
  confirm(credentialId: string, code: string): Promise<Result<TotpRecord, DomainError>> {
    const { context, uow, authorizer, credentials, totps, audit, clock, confirmAttempts } =
      this.deps;
    const permission: Permission = 'credential.update';
    return uow.run(async () => {
      await authorizer.require({ permission });
      const current = context.current();
      const actorId = this.requireActorId();

      const credential = await this.liveOrNull(await credentials.findByIdForUpdate(credentialId));
      if (credential === null) return err(notFound());
      const level = await this.levelOrNotFound(credential, actorId, permission, 'EDIT');
      if (!level.ok) return level;

      const totp = await totps.find(credential.id);
      if (totp === null) return err(notFound());
      if (totp.status !== 'pending') return err(stateInvalid());

      // El tope se revisa ANTES de comparar el código: un registro agotado no sirve de oráculo. La fila de la
      // credencial ya está bloqueada, así que dos confirmaciones concurrentes no se cuelan a la vez.
      // La llave incluye la versión del secreto: re-registrar abre un registro nuevo con la cuenta en cero.
      const attemptKey = `${credential.id}:${String(totp.secretVersion)}`;
      const failedAttempts = await confirmAttempts.failures(attemptKey);
      if (failedAttempts >= TOTP_CONFIRM_MAX_FAILURES) {
        await authorizer.auditDenial({
          code: 'CREDENTIAL.TOTP_CONFIRM_LOCKED',
          permission,
          targetAccountId: credential.accountId,
        });
        return err(
          new DomainError(
            'CREDENTIAL.TOTP_CONFIRM_LOCKED',
            'The attempts to confirm this registration have run out',
          ),
        );
      }

      const matches = await this.codeMatches(credential, totp, code, clock.now());
      if (!matches.ok) return matches;
      if (!matches.value) {
        await confirmAttempts.recordFailure(attemptKey);
        await audit.record({
          action: 'credential.totp_confirmed',
          actorId,
          targetType: 'credential',
          targetId: credential.id,
          outcome: 'failure',
          reasonCode: 'CREDENTIAL.TOTP_CODE_INVALID',
          ip: null,
          requestId: current.requestId,
          metadata: {},
        });
        return err(
          new DomainError('CREDENTIAL.TOTP_CODE_INVALID', 'The code does not match the secret'),
        );
      }

      await confirmAttempts.clear(attemptKey);
      await totps.markVerified(credential.id, clock.now());
      await audit.record({
        action: 'credential.totp_confirmed',
        actorId,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {},
      });
      const saved = await totps.find(credential.id);
      if (saved === null) throw new Error('The second factor just confirmed was not found');
      return ok(saved);
    });
  }

  /**
   * Código vigente. Cuando quedan menos de 5 s se entrega también el siguiente, para que quien lo
   * teclea no llegue tarde. Cada código emitido deja un evento ligero y cuenta para el tope.
   */
  issueCode(credentialId: string): Promise<Result<IssuedTotpCode, DomainError>> {
    const { context, uow, authorizer, credentials, totps, audit, auditCounter, clock } = this.deps;
    const permission: Permission = 'credential.use_totp';
    return uow.run(async () => {
      await authorizer.require({ permission });
      const current = context.current();
      const actorId = this.requireActorId();

      // Se bloquea la fila: un re-registro o retiro concurrente no puede cambiar el factor a media emisión.
      const credential = await this.liveOrNull(await credentials.findByIdForUpdate(credentialId));
      if (credential === null) return err(notFound());
      const level = await this.levelOrNotFound(credential, actorId, permission, 'USE');
      if (!level.ok) return level;

      const totp = await totps.find(credential.id);
      if (totp === null) return err(notFound());
      if (totp.status === 'retired') return err(stateInvalid());

      // Sin este bloqueo, dos peticiones concurrentes verían las dos "9 de 10" y pasarían ambas.
      await totps.lockCodesOf(actorId, credential.id);
      const now = clock.now();
      const issuedInWindow = await auditCounter.count({
        actorId,
        action: 'credential.totp_code_issued',
        outcome: 'success',
        since: new Date(now.getTime() - CODE_WINDOW_MS),
        targetId: credential.id,
      });
      if (issuedInWindow >= TOTP_CODES_PER_MINUTE) {
        await authorizer.auditDenial({
          code: 'CREDENTIAL.TOTP_CODE_LIMIT',
          permission,
          targetAccountId: credential.accountId,
        });
        return err(
          new DomainError('CREDENTIAL.TOTP_CODE_LIMIT', 'Too many codes requested for this minute'),
        );
      }

      const parameters = await this.openParameters(credential);
      if (!parameters.ok) return parameters;
      const { secretBase32 } = parameters.value;
      const code = this.deps.generator.codeAt(secretBase32, totp, now);

      const nowSeconds = Math.floor(now.getTime() / MILLISECONDS_PER_SECOND);
      const expiresIn = totp.periodSeconds - (nowSeconds % totp.periodSeconds);
      const issued: IssuedTotpCode =
        expiresIn < TOTP_NEXT_CODE_THRESHOLD_SECONDS
          ? {
              code,
              expiresIn,
              nextCode: this.deps.generator.codeAt(
                secretBase32,
                totp,
                new Date(now.getTime() + expiresIn * MILLISECONDS_PER_SECOND),
              ),
            }
          : { code, expiresIn };

      await audit.record({
        action: 'credential.totp_code_issued',
        actorId,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {},
      });
      return ok(issued);
    });
  }

  /**
   * Muestra una sola vez el URI y la clave. Exige MANAGE, reautenticación y motivo escrito; deja el evento
   * crítico, marca la credencial como "secreto expuesto" y abre una tarea de rotación.
   */
  exportSecret(
    credentialId: string,
    reason: string | undefined,
  ): Promise<Result<ExportedTotpSecret, DomainError>> {
    const { context, uow, authorizer, credentials, totps, audit, clock } = this.deps;
    const permission: Permission = 'credential.export_totp';
    return uow.run(async () => {
      // Permiso y reautenticación de 5 minutos: la decisión es del motor de autorización.
      await authorizer.require({ permission });
      const current = context.current();
      const actorId = this.requireActorId();

      const credential = await this.liveOrNull(await credentials.findByIdForUpdate(credentialId));
      if (credential === null) return err(notFound());
      const level = await this.levelOrNotFound(credential, actorId, permission, 'MANAGE');
      if (!level.ok) return level;

      if (!isValidRevealReason(reason)) {
        await authorizer.auditDenial({
          code: 'CREDENTIAL.REASON_INVALID',
          permission,
          targetAccountId: credential.accountId,
        });
        return err(
          new DomainError('CREDENTIAL.REASON_INVALID', 'A written reason is required', {
            minLength: REVEAL_REASON_MIN_LENGTH,
            maxLength: REVEAL_REASON_MAX_LENGTH,
          }),
        );
      }

      const totp = await totps.find(credential.id);
      if (totp === null) return err(notFound());
      if (totp.status === 'retired') return err(stateInvalid());

      const opened = await this.openParameters(credential);
      if (!opened.ok) {
        await audit.record({
          action: 'credential.totp_exported',
          actorId,
          targetType: 'credential',
          targetId: credential.id,
          outcome: 'failure',
          reasonCode: opened.error.code,
          ip: null,
          requestId: current.requestId,
          metadata: {},
        });
        return opened;
      }

      const now = clock.now();
      await totps.markExposed(credential.id, now);
      if (!(await totps.openExportRotationTaskExists(credential.id))) {
        await totps.insertExportRotationTask({
          credentialId: credential.id,
          triggeredByUser: actorId,
          assignedTo: actorId,
          dueAt: new Date(now.getTime() + ROTATION_TASK_DUE_DAYS * MILLISECONDS_PER_DAY),
        });
      }

      await audit.record({
        action: 'credential.totp_exported',
        actorId,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { reason: reason.trim() },
      });
      return ok({
        otpauthUri: opened.value.normalizedUri,
        secretKey: opened.value.secretBase32,
      });
    });
  }

  /** Apaga el segundo factor. El secreto cifrado se conserva como versión retenida, no se borra aquí. */
  retire(credentialId: string): Promise<Result<TotpRecord, DomainError>> {
    const { context, uow, authorizer, credentials, totps, audit, clock } = this.deps;
    const permission: Permission = 'credential.update';
    return uow.run(async () => {
      await authorizer.require({ permission });
      const current = context.current();
      const actorId = this.requireActorId();

      const credential = await this.liveOrNull(await credentials.findByIdForUpdate(credentialId));
      if (credential === null) return err(notFound());
      const level = await this.levelOrNotFound(credential, actorId, permission, 'EDIT');
      if (!level.ok) return level;

      const totp = await totps.find(credential.id);
      if (totp === null) return err(notFound());
      if (totp.status === 'retired') return err(stateInvalid());

      await totps.markRetired(credential.id, clock.now());
      await audit.record({
        action: 'credential.totp_retired',
        actorId,
        targetType: 'credential',
        targetId: credential.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {},
      });
      const saved = await totps.find(credential.id);
      if (saved === null) throw new Error('The second factor just retired was not found');
      return ok(saved);
    });
  }

  /** Compara el secreto vigente (si lo hay) con el nuevo; un fallo al descifrar cuenta como "distinto". */
  private async sameSecretAsCurrent(
    credential: CredentialRecord,
    newSecretBase32: string,
  ): Promise<boolean> {
    const currentSecret = await this.deps.credentials.currentSecret(credential.id, TOTP_FIELD);
    if (currentSecret === null) return false;
    const opened = await this.openParameters(credential);
    return opened.ok && opened.value.secretBase32 === newSecretBase32;
  }

  private async codeMatches(
    credential: CredentialRecord,
    totp: TotpRecord,
    submittedCode: string,
    now: Date,
  ): Promise<Result<boolean, DomainError>> {
    const opened = await this.openParameters(credential);
    if (!opened.ok) return opened;
    const { secretBase32 } = opened.value;
    for (let step = -CONFIRM_STEP_TOLERANCE; step <= CONFIRM_STEP_TOLERANCE; step += 1) {
      const at = new Date(now.getTime() + step * totp.periodSeconds * MILLISECONDS_PER_SECOND);
      if (this.deps.generator.codeAt(secretBase32, totp, at) === submittedCode) return ok(true);
    }
    return ok(false);
  }

  /** Descifra el URI vigente y lo vuelve a analizar. El texto en claro vive solo dentro de esta llamada. */
  private async openParameters(
    credential: CredentialRecord,
  ): Promise<
    Result<TotpParameters & { secretBase32: string; normalizedUri: string }, DomainError>
  > {
    const { context, credentials, cipher } = this.deps;
    const secret = await credentials.currentSecret(credential.id, TOTP_FIELD);
    if (secret === null) return err(notFound());
    const opened = await cipher.decrypt(
      {
        organizationId: context.current().organizationId,
        resourceId: credential.id,
        field: TOTP_FIELD,
        version: secret.version,
      },
      { ciphertext: secret.ciphertext, nonce: secret.nonce, dekVersion: secret.dekVersion },
    );
    if (!opened.ok) return err(opened.error);
    let uri: string;
    try {
      uri = textDecoder.decode(opened.value);
    } finally {
      opened.value.fill(0);
    }
    const parsed = parseOtpauthUri(uri);
    // Lo guardado ya pasó la validación al registrarlo: si ya no la pasa, el dato está dañado.
    if (!parsed.ok) throw new Error('The stored second factor could not be read');
    return ok(parsed.value);
  }

  /**
   * Cifra y guarda el URI. Si la criptografía falla LANZA el error en vez de devolverlo: la unidad de trabajo
   * solo revierte ante una excepción, y devolver un `err` confirmaría un registro a medias.
   */
  private async storeUri(
    credentialId: string,
    version: number,
    uri: string,
    createdBy: UserId,
  ): Promise<void> {
    const { context, credentials, cipher, ids } = this.deps;
    const bytes = textEncoder.encode(uri);
    let encrypted;
    try {
      encrypted = await cipher.encrypt(
        {
          organizationId: context.current().organizationId,
          resourceId: credentialId,
          field: TOTP_FIELD,
          version,
        },
        bytes,
      );
    } finally {
      bytes.fill(0);
    }
    if (!encrypted.ok) throw encrypted.error;

    await credentials.insertSecret({
      id: ids.next(),
      credentialId,
      field: TOTP_FIELD,
      version,
      ciphertext: encrypted.value.ciphertext,
      nonce: encrypted.value.nonce,
      dekVersion: encrypted.value.dekVersion,
      blindIndexHex: null,
      createdBy,
    });
  }

  /**
   * Segunda llave: el nivel de acceso a la cuenta. Sin acceso se responde como si no existiera (y se audita
   * el intento); con menos nivel del requerido se niega con `AUTHZ.SHARE` y se audita la negación.
   */
  private async levelOrNotFound(
    credential: CredentialRecord,
    actorId: UserId,
    permission: Permission,
    required: ShareLevel,
  ): Promise<Result<ShareLevel, DomainError>> {
    const { authorizer, accounts } = this.deps;
    const level = await accounts.effectiveLevel(credential.accountId, actorId);
    if (level === null) {
      await authorizer.auditDenial({
        code: 'AUTHZ.SHARE',
        permission,
        targetAccountId: credential.accountId,
      });
      return err(notFound());
    }
    if (!levelSatisfies(level, required)) {
      await authorizer.auditDenial({
        code: 'AUTHZ.SHARE',
        permission,
        targetAccountId: credential.accountId,
      });
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
