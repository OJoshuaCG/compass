/**
 * Servidor SMTP de la organización (ADR 0047, enmienda del 2026-11-17): crear, editar, reintroducir la
 * contraseña, archivar y enviar un correo de prueba.
 *
 * Invariantes de seguridad
 * - Todo exige `alerts.infra.manage` (solo Raíz) con reautenticación reciente y auditoría crítica según el
 *   catálogo; el autorizador lo hace cumplir antes de cualquier lectura o escritura.
 * - La contraseña se cifra solo con el módulo de criptografía y el búfer en claro se borra. Nunca se
 *   devuelve, se registra ni se audita; la lectura solo informa si existe.
 * - Toda escritura de la contraseña sube `secret_version`: un recifrado en curso con la versión anterior
 *   choca y no puede resucitar la contraseña vieja.
 * - Todo lo que puede responder con `err` va ANTES de la primera escritura: la unidad de trabajo confirma
 *   cualquier retorno que no lance. Un fallo de cifrado se LANZA para revertir.
 * - La auditoría es el último paso de cada escritura y solo lleva tipo, nombres de campo y versión: nunca la
 *   contraseña, el host, el usuario ni la respuesta del servidor SMTP.
 * - Solo canales cifrados (`starttls` o `tls`) y solo nombres DNS: la comprobación de red privada la hace el
 *   adaptador de envío sobre el nombre ya resuelto.
 * - La contraseña guardada no se puede reutilizar contra otro destino: si cambia el servidor, el puerto, la
 *   seguridad o el usuario y ya hay una guardada, la misma petición debe traer la contraseña nueva.
 * - El correo de prueba va a la dirección remitente configurada (no hay un campo de destinatario aparte).
 * - La prueba no mantiene abierta una transacción mientras habla con la red: lee y descifra en una
 *   transacción corta, envía fuera de ella y audita en otra. Si la auditoría fallara tras el envío, el
 *   correo ya salió sin registro; es el costo de no retener la fila ni una conexión del pool.
 */
import { smtpDestinationChanged, type SmtpSecurityValue } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { normalizeIntegrationName } from '../domain/integration-config.js';
import { integrationSecretContext } from '../domain/integration-secret-context.js';
import {
  SMTP_INTEGRATION_KIND,
  SMTP_MANAGE_PERMISSION,
  SMTP_PASSWORD_FIELD,
  isSmtpSecurity,
  isValidSmtpPassword,
  isValidSmtpPort,
  normalizeSmtpFromAddress,
  normalizeSmtpHost,
  normalizeSmtpUsername,
} from '../domain/smtp-config.js';
import { openSmtpPassword } from './open-smtp-password.js';
import type {
  SmtpConnectionFields,
  SmtpSettingsRecord,
  SmtpSettingsStore,
  SmtpTestSendResult,
  SmtpTestSender,
} from './ports/smtp-settings-store.js';

const FIRST_SECRET_VERSION = 1;
const AUDIT_TARGET_TYPE = 'integration';

const textEncoder = new TextEncoder();

export interface ManageSmtpSettingsDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly settings: SmtpSettingsStore;
  readonly cipher: Pick<SecretCipher, 'encrypt' | 'decrypt'>;
  readonly sender: SmtpTestSender;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export interface SmtpSettingsInput {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurityValue;
  readonly username: string;
  readonly fromAddress: string;
}

export interface CreateSmtpSettingsInput extends SmtpSettingsInput {
  readonly password: string;
}

export interface UpdateSmtpSettingsInput extends SmtpSettingsInput {
  /** Obligatoria si cambia el destino de la conexión y ya hay una contraseña guardada. */
  readonly password?: string | undefined;
}

/** Resultado de la prueba: `sent` o el código estable de fallo del adaptador; nunca texto del servidor. */
export type SmtpTestOutcome = 'sent' | Extract<SmtpTestSendResult, { ok: false }>['code'];

interface ValidatedSettings extends SmtpConnectionFields {
  readonly name: string;
}

export class ManageSmtpSettings {
  constructor(private readonly deps: ManageSmtpSettingsDeps) {}

  list(): Promise<Result<readonly SmtpSettingsRecord[], DomainError>> {
    const { uow, authorizer, settings } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: SMTP_MANAGE_PERMISSION });
      return ok(await settings.list());
    });
  }

  create(input: CreateSmtpSettingsInput): Promise<Result<SmtpSettingsRecord, DomainError>> {
    const { uow, authorizer, settings } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: SMTP_MANAGE_PERMISSION });
      const actorId = this.requireActorId();

      const validated = validateSettings(input);
      if (!validated.ok) return validated;
      if (!isValidSmtpPassword(input.password)) return invalidInput('password');
      if ((await settings.findActive()) !== null) return channelAlreadyActive();

      const created = await settings.insert({ ...validated.value, createdBy: actorId });
      // Sin fila: otra petición creó el servidor activo entre la lectura y el alta (índice único parcial).
      if (created === null) return channelAlreadyActive();
      await this.storePassword(created.id, FIRST_SECRET_VERSION, input.password);
      await this.recordSuccess('integration.created', actorId, created.id, {});
      return ok({ ...created, hasPassword: true });
    });
  }

  update(
    settingsId: string,
    input: UpdateSmtpSettingsInput,
  ): Promise<Result<SmtpSettingsRecord, DomainError>> {
    const { uow, settings } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(settingsId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      const validated = validateSettings(input);
      if (!validated.ok) return validated;

      const newPassword = input.password;
      if (newPassword !== undefined && !isValidSmtpPassword(newPassword)) {
        return invalidInput('password');
      }

      const changedFields = changedFieldNames(existing, validated.value);
      // Cambiar el destino con la contraseña vieja la enviaría a un servidor que nunca la recibió de la
      // persona (p. ej. un host nuevo y una prueba de envío): se exige reescribirla en la misma petición.
      const destinationChanged = smtpDestinationChanged(existing, validated.value);
      if (destinationChanged && existing.hasPassword && newPassword === undefined) {
        return invalidInput('password');
      }
      const connectionChanged = changedFields.length > 0;
      // Sin cambios no se escribe ni se audita: un evento vacío solo ensucia la bitácora.
      if (!connectionChanged && newPassword === undefined) return ok(existing);

      const saved = connectionChanged
        ? await settings.update(existing.id, validated.value)
        : existing;
      const auditedFields = [...changedFields];
      if (newPassword !== undefined) {
        await this.replacePassword(existing.id, newPassword);
        auditedFields.push(SMTP_PASSWORD_FIELD);
      }
      await this.recordSuccess('integration.updated', actorId, existing.id, {
        changedFields: auditedFields.join(','),
      });
      return ok(newPassword === undefined ? saved : { ...saved, hasPassword: true });
    });
  }

  rotatePassword(
    settingsId: string,
    password: string,
  ): Promise<Result<SmtpSettingsRecord, DomainError>> {
    const { uow } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(settingsId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      if (!isValidSmtpPassword(password)) return invalidInput('password');

      const secretVersion = await this.replacePassword(existing.id, password);
      await this.recordSuccess('integration.secret_rotated', actorId, existing.id, {
        field: SMTP_PASSWORD_FIELD,
        secretVersion,
      });
      return ok({ ...existing, hasPassword: true });
    });
  }

  archive(settingsId: string): Promise<Result<SmtpSettingsRecord, DomainError>> {
    const { uow, settings, clock } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(settingsId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      const saved = await settings.archive(existing.id, clock.now());
      await this.recordSuccess('integration.archived', actorId, existing.id, {});
      return ok(saved);
    });
  }

  /**
   * Envía un correo fijo a la dirección remitente para comprobar host, seguridad, usuario y contraseña. Un
   * fallo del envío NO es un error de la operación: se informa en el resultado y se audita; solo la
   * configuración incompleta responde con `err`.
   */
  async sendTest(settingsId: string): Promise<Result<SmtpTestOutcome, DomainError>> {
    const { uow, settings, cipher, sender, context } = this.deps;
    // Transacción corta: autoriza, lee y descifra. El bloqueo de la fila termina antes de tocar la red.
    const prepared = await uow.run(async () => {
      const current = await this.loadManageable(settingsId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      const stored = await settings.findPassword(existing.id);
      if (stored === null) {
        return err(
          new DomainError('INTEGRATIONS.NOT_CONFIGURED', 'The SMTP server has no saved password'),
        );
      }
      const password = await openSmtpPassword(
        cipher,
        context.current().organizationId,
        existing.id,
        stored,
      );
      return ok({ existing, actorId, password });
    });
    if (!prepared.ok) return prepared;
    const { existing, actorId, password } = prepared.value;

    // Sin transacción abierta: DNS, TCP, TLS y SMTP pueden tardar decenas de segundos.
    const result: SmtpTestSendResult = await sender.send({
      connection: {
        host: existing.host,
        port: existing.port,
        security: existing.security,
        username: existing.username,
        fromAddress: existing.fromAddress,
      },
      password,
      recipient: existing.fromAddress,
    });
    const outcome: SmtpTestOutcome = result.ok ? 'sent' : result.code;
    await uow.run(() =>
      this.recordAudit(
        'integration.test_sent',
        actorId,
        existing.id,
        { outcome },
        result.ok
          ? { outcome: 'success', reasonCode: null }
          : { outcome: 'failure', reasonCode: result.code },
      ),
    );
    return ok(outcome);
  }

  /** Carga y bloquea la configuración y exige el permiso. Una archivada no admite cambios. */
  private async loadManageable(
    settingsId: string,
  ): Promise<Result<SmtpSettingsRecord, DomainError>> {
    const { authorizer, settings } = this.deps;
    await authorizer.require({ permission: SMTP_MANAGE_PERMISSION });
    const found = await settings.findForUpdate(settingsId);
    if (found === null) return err(new DomainError('NOT_FOUND', 'SMTP settings not found'));
    if (found.status === 'archived') {
      return err(new DomainError('INTEGRATIONS.ARCHIVED', 'The SMTP settings are archived'));
    }
    return ok(found);
  }

  /**
   * Guarda una contraseña nueva con la versión siguiente a la almacenada (o la primera) y devuelve esa
   * versión, que la auditoría registra. La usan la edición y el cambio de contraseña.
   */
  private async replacePassword(settingsId: string, password: string): Promise<number> {
    const stored = await this.deps.settings.findPassword(settingsId);
    const secretVersion = stored === null ? FIRST_SECRET_VERSION : stored.secretVersion + 1;
    await this.storePassword(settingsId, secretVersion, password);
    return secretVersion;
  }

  private recordSuccess(
    action: string,
    actorId: UserId,
    targetId: string,
    metadata: Record<string, string | number>,
  ): Promise<void> {
    return this.recordAudit(action, actorId, targetId, metadata, {
      outcome: 'success',
      reasonCode: null,
    });
  }

  /** Solo lleva el tipo, nombres de campo y versión: nunca la contraseña ni la respuesta del servidor. */
  private async recordAudit(
    action: string,
    actorId: UserId,
    targetId: string,
    metadata: Record<string, string | number>,
    result: { readonly outcome: 'success' | 'failure'; readonly reasonCode: string | null },
  ): Promise<void> {
    const { audit, context } = this.deps;
    await audit.record({
      action,
      actorId,
      targetType: AUDIT_TARGET_TYPE,
      targetId,
      outcome: result.outcome,
      reasonCode: result.reasonCode,
      ip: null,
      requestId: context.current().requestId,
      metadata: { kind: SMTP_INTEGRATION_KIND, ...metadata },
    });
  }

  /** Cifra con el contexto de la versión nueva. Un fallo se LANZA: devolver `err` confirmaría lo escrito. */
  private async storePassword(
    settingsId: string,
    secretVersion: number,
    password: string,
  ): Promise<void> {
    const { cipher, settings, context, clock } = this.deps;
    const bytes = textEncoder.encode(password);
    let encrypted;
    try {
      encrypted = await cipher.encrypt(
        integrationSecretContext(
          context.current().organizationId,
          settingsId,
          SMTP_PASSWORD_FIELD,
          secretVersion,
        ),
        bytes,
      );
    } finally {
      bytes.fill(0);
    }
    if (!encrypted.ok) throw encrypted.error;
    await settings.putPassword({
      settingsId,
      secretVersion,
      encrypted: encrypted.value,
      rotatedAt: clock.now(),
    });
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}

function validateSettings(input: SmtpSettingsInput): Result<ValidatedSettings, DomainError> {
  const name = normalizeIntegrationName(input.name);
  if (name === null) return invalidInput('name');
  const host = normalizeSmtpHost(input.host);
  if (host === null) return invalidInput('host');
  if (!isValidSmtpPort(input.port)) return invalidInput('port');
  if (!isSmtpSecurity(input.security)) return invalidInput('security');
  const username = normalizeSmtpUsername(input.username);
  if (username === null) return invalidInput('username');
  const fromAddress = normalizeSmtpFromAddress(input.fromAddress);
  if (fromAddress === null) return invalidInput('fromAddress');
  return ok({ name, host, port: input.port, security: input.security, username, fromAddress });
}

function changedFieldNames(existing: SmtpSettingsRecord, next: ValidatedSettings): string[] {
  const changed: string[] = [];
  if (next.name !== existing.name) changed.push('name');
  if (next.host !== existing.host) changed.push('host');
  if (next.port !== existing.port) changed.push('port');
  if (next.security !== existing.security) changed.push('security');
  if (next.username !== existing.username) changed.push('username');
  if (next.fromAddress !== existing.fromAddress) changed.push('fromAddress');
  return changed;
}

function channelAlreadyActive(): Result<never, DomainError> {
  return err(
    new DomainError('INTEGRATIONS.CHANNEL_ALREADY_ACTIVE', 'An active SMTP server already exists'),
  );
}

/** Solo el nombre del campo inválido; nunca su valor (puede ser la contraseña o un dato personal). */
function invalidInput(field: string): Result<never, DomainError> {
  return err(new DomainError('VALIDATION.FAILED', 'Invalid SMTP settings input', { field }));
}
