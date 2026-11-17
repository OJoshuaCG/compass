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
 * - El correo de prueba va a la propia dirección remitente: nunca a un destino que alguien teclee.
 */
import type { SmtpSecurityValue } from '@iam/contracts';

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
  isSmtpSecurity,
  isValidSmtpPassword,
  isValidSmtpPort,
  normalizeSmtpFromAddress,
  normalizeSmtpHost,
  normalizeSmtpUsername,
} from '../domain/smtp-config.js';
import type {
  SmtpConnectionFields,
  SmtpSettingsRecord,
  SmtpSettingsStore,
  SmtpTestSendResult,
  SmtpTestSender,
} from './ports/smtp-settings-store.js';

const FIRST_SECRET_VERSION = 1;
const PASSWORD_FIELD = 'smtp_password';
const AUDIT_TARGET_TYPE = 'integration';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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
    const { uow, authorizer, settings, audit, context } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: SMTP_MANAGE_PERMISSION });
      const actorId = this.requireActorId();

      const validated = validateSettings(input);
      if (!validated.ok) return validated;
      if (!isValidSmtpPassword(input.password)) return invalidInput('password');
      if ((await settings.findActive()) !== null) {
        return err(
          new DomainError(
            'INTEGRATIONS.CHANNEL_ALREADY_ACTIVE',
            'An active SMTP server already exists',
          ),
        );
      }

      const created = await settings.insert({ ...validated.value, createdBy: actorId });
      await this.storePassword(created.id, FIRST_SECRET_VERSION, input.password);
      await audit.record({
        action: 'integration.created',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: created.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: SMTP_INTEGRATION_KIND },
      });
      return ok({ ...created, hasPassword: true });
    });
  }

  update(
    settingsId: string,
    input: SmtpSettingsInput,
  ): Promise<Result<SmtpSettingsRecord, DomainError>> {
    const { uow, settings, audit, context } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(settingsId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      const validated = validateSettings(input);
      if (!validated.ok) return validated;

      const changedFields = changedFieldNames(existing, validated.value);
      // Sin cambios no se escribe ni se audita: un evento vacío solo ensucia la bitácora.
      if (changedFields.length === 0) return ok(existing);

      const saved = await settings.update(existing.id, validated.value);
      await audit.record({
        action: 'integration.updated',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: existing.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: SMTP_INTEGRATION_KIND, changedFields: changedFields.join(',') },
      });
      return ok(saved);
    });
  }

  rotatePassword(
    settingsId: string,
    password: string,
  ): Promise<Result<SmtpSettingsRecord, DomainError>> {
    const { uow, settings, audit, context } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(settingsId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      if (!isValidSmtpPassword(password)) return invalidInput('password');

      const stored = await settings.findPassword(existing.id);
      const secretVersion = stored === null ? FIRST_SECRET_VERSION : stored.secretVersion + 1;
      await this.storePassword(existing.id, secretVersion, password);
      await audit.record({
        action: 'integration.secret_rotated',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: existing.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: SMTP_INTEGRATION_KIND, field: PASSWORD_FIELD, secretVersion },
      });
      return ok({ ...existing, hasPassword: true });
    });
  }

  archive(settingsId: string): Promise<Result<SmtpSettingsRecord, DomainError>> {
    const { uow, settings, audit, context, clock } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(settingsId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      const saved = await settings.archive(existing.id, clock.now());
      await audit.record({
        action: 'integration.archived',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: existing.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: SMTP_INTEGRATION_KIND },
      });
      return ok(saved);
    });
  }

  /**
   * Envía un correo fijo a la dirección remitente para comprobar host, seguridad, usuario y contraseña. Un
   * fallo del envío NO es un error de la operación: se informa en el resultado y se audita; solo la
   * configuración incompleta responde con `err`.
   */
  sendTest(settingsId: string): Promise<Result<SmtpTestOutcome, DomainError>> {
    const { uow, settings, cipher, sender, audit, context } = this.deps;
    return uow.run(async () => {
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
      const opened = await cipher.decrypt(
        integrationSecretContext(
          context.current().organizationId,
          existing.id,
          PASSWORD_FIELD,
          stored.secretVersion,
        ),
        stored.encrypted,
      );
      // Una contraseña que no se abre es un fallo del servicio de llaves, no de la persona: se LANZA.
      if (!opened.ok) throw opened.error;

      let result: SmtpTestSendResult;
      try {
        result = await sender.send({
          connection: {
            host: existing.host,
            port: existing.port,
            security: existing.security,
            username: existing.username,
            fromAddress: existing.fromAddress,
          },
          password: textDecoder.decode(opened.value),
          recipient: existing.fromAddress,
        });
      } finally {
        opened.value.fill(0);
      }
      const outcome: SmtpTestOutcome = result.ok ? 'sent' : result.code;
      await audit.record({
        action: 'integration.test_sent',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: existing.id,
        outcome: result.ok ? 'success' : 'failure',
        reasonCode: result.ok ? null : result.code,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: SMTP_INTEGRATION_KIND, outcome },
      });
      return ok(outcome);
    });
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
          PASSWORD_FIELD,
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

/** Solo el nombre del campo inválido; nunca su valor (puede ser la contraseña o un dato personal). */
function invalidInput(field: string): Result<never, DomainError> {
  return err(new DomainError('VALIDATION.FAILED', 'Invalid SMTP settings input', { field }));
}
