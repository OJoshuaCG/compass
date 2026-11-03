/**
 * Configuración de los canales de Telegram (ADR 0047): crear, editar, reintroducir el token, archivar y
 * enviar un mensaje de prueba.
 *
 * Invariantes de seguridad
 * - Cada canal tiene su propio permiso: infraestructura `alerts.infra.manage` (solo Raíz) y seguridad
 *   `alerts.security.manage`. Ambos piden reautenticación reciente y auditoría crítica según el catálogo;
 *   el autorizador lo hace cumplir antes de cualquier lectura o escritura.
 * - El token se cifra solo con el módulo de criptografía y el búfer en claro se borra. Nunca se devuelve, se
 *   registra ni se audita; la lectura solo informa si existe.
 * - Toda escritura del token sube `secret_version`: un recifrado en curso con la versión anterior choca y no
 *   puede resucitar el token viejo.
 * - Todo lo que puede responder con `err` va ANTES de la primera escritura: la unidad de trabajo confirma
 *   cualquier retorno que no lance. Un fallo de cifrado se LANZA para revertir.
 * - La auditoría es el último paso de cada escritura y solo lleva tipo, nombres de campo y versión: nunca el
 *   token, el chat ni la respuesta de Telegram.
 * - Una integración archivada no se modifica ni se prueba: para volver a usar el canal se crea otra.
 */
import type { Permission } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import {
  TELEGRAM_BOT_TOKEN_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
  TELEGRAM_INTEGRATION_KINDS,
  TELEGRAM_KIND_PERMISSION,
  normalizeIntegrationName,
} from '../domain/integration-config.js';
import type { TelegramIntegrationKind } from '../domain/integration-config.js';
import { integrationSecretContext } from '../domain/integration-secret-context.js';
import type { IntegrationRecord, IntegrationRepository } from './ports/integration-repository.js';
import type { TelegramSendResult, TelegramSender } from './ports/telegram-sender.js';

const FIRST_SECRET_VERSION = 1;
const BOT_TOKEN_FIELD = 'bot_token';
const AUDIT_TARGET_TYPE = 'integration';
const TEST_MESSAGE_TEXT = '[Compass] Mensaje de prueba / Test message';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface ManageTelegramIntegrationsDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly integrations: IntegrationRepository;
  readonly cipher: Pick<SecretCipher, 'encrypt' | 'decrypt'>;
  readonly sender: TelegramSender;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export interface CreateTelegramIntegrationInput {
  readonly kind: TelegramIntegrationKind;
  readonly name: string;
  readonly chatId: string;
  readonly botToken: string;
}

export interface UpdateTelegramIntegrationInput {
  readonly name: string;
  readonly chatId: string;
}

/** Resultado de la prueba: `sent` o el código estable de fallo del adaptador; nunca el texto de Telegram. */
export type TestSendOutcome = 'sent' | Extract<TelegramSendResult, { ok: false }>['code'];

export class ManageTelegramIntegrations {
  constructor(private readonly deps: ManageTelegramIntegrationsDeps) {}

  /** Las integraciones de los canales que la persona puede administrar; sin ninguno, la lista va vacía. */
  list(): Promise<Result<readonly IntegrationRecord[], DomainError>> {
    const { uow, authorizer, integrations } = this.deps;
    return uow.run(async () => {
      const permissions = await authorizer.actorPermissions();
      const manageableKinds = TELEGRAM_INTEGRATION_KINDS.filter((kind) =>
        permissions.has(TELEGRAM_KIND_PERMISSION[kind]),
      );
      if (manageableKinds.length === 0) {
        // Sin ningún permiso de canal se niega (y se audita) en vez de devolver una lista vacía engañosa.
        await authorizer.require({ permission: TELEGRAM_KIND_PERMISSION.telegram_security });
      }
      return ok(await integrations.listByKinds(manageableKinds));
    });
  }

  create(input: CreateTelegramIntegrationInput): Promise<Result<IntegrationRecord, DomainError>> {
    const { uow, authorizer, integrations, audit, context } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: TELEGRAM_KIND_PERMISSION[input.kind] });
      const actorId = this.requireActorId();

      const name = normalizeIntegrationName(input.name);
      if (name === null) return invalidInput('name');
      if (!TELEGRAM_CHAT_ID_PATTERN.test(input.chatId)) return invalidInput('chatId');
      if (!TELEGRAM_BOT_TOKEN_PATTERN.test(input.botToken)) return invalidInput('botToken');
      if ((await integrations.findActiveByKind(input.kind)) !== null) {
        return err(
          new DomainError(
            'INTEGRATIONS.CHANNEL_ALREADY_ACTIVE',
            'An active channel of this kind already exists',
          ),
        );
      }

      const created = await integrations.insert({
        kind: input.kind,
        name,
        chatId: input.chatId,
        createdBy: actorId,
      });
      await this.storeBotToken(created.id, FIRST_SECRET_VERSION, input.botToken);
      await audit.record({
        action: 'integration.created',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: created.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: created.kind },
      });
      return ok({ ...created, hasBotToken: true });
    });
  }

  update(
    integrationId: string,
    input: UpdateTelegramIntegrationInput,
  ): Promise<Result<IntegrationRecord, DomainError>> {
    const { uow, integrations, audit, context } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(integrationId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      const name = normalizeIntegrationName(input.name);
      if (name === null) return invalidInput('name');
      if (!TELEGRAM_CHAT_ID_PATTERN.test(input.chatId)) return invalidInput('chatId');

      const changedFields: string[] = [];
      if (name !== existing.name) changedFields.push('name');
      if (input.chatId !== existing.chatId) changedFields.push('chatId');
      // Sin cambios no se escribe ni se audita: un evento vacío solo ensucia la bitácora.
      if (changedFields.length === 0) return ok(existing);

      const saved = await integrations.update(existing.id, { name, chatId: input.chatId });
      await audit.record({
        action: 'integration.updated',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: existing.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: existing.kind, changedFields: changedFields.join(',') },
      });
      return ok(saved);
    });
  }

  rotateBotToken(
    integrationId: string,
    botToken: string,
  ): Promise<Result<IntegrationRecord, DomainError>> {
    const { uow, integrations, audit, context } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(integrationId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      if (!TELEGRAM_BOT_TOKEN_PATTERN.test(botToken)) return invalidInput('botToken');

      const stored = await integrations.findSecret(existing.id, BOT_TOKEN_FIELD);
      const secretVersion = stored === null ? FIRST_SECRET_VERSION : stored.secretVersion + 1;
      await this.storeBotToken(existing.id, secretVersion, botToken);
      await audit.record({
        action: 'integration.secret_rotated',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: existing.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: existing.kind, field: BOT_TOKEN_FIELD, secretVersion },
      });
      return ok({ ...existing, hasBotToken: true });
    });
  }

  archive(integrationId: string): Promise<Result<IntegrationRecord, DomainError>> {
    const { uow, integrations, audit, context, clock } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(integrationId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      const saved = await integrations.archive(existing.id, clock.now());
      await audit.record({
        action: 'integration.archived',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: existing.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: existing.kind },
      });
      return ok(saved);
    });
  }

  /**
   * Envía un mensaje fijo al chat configurado para comprobar token y chat. Un fallo del envío NO es un error
   * de la operación: se informa en el resultado y se audita; solo configuración faltante responde con `err`.
   */
  sendTest(integrationId: string): Promise<Result<TestSendOutcome, DomainError>> {
    const { uow, integrations, cipher, sender, audit, context } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(integrationId);
      if (!current.ok) return current;
      const existing = current.value;
      const actorId = this.requireActorId();

      const stored = await integrations.findSecret(existing.id, BOT_TOKEN_FIELD);
      if (stored === null || existing.chatId === null) {
        return err(
          new DomainError('INTEGRATIONS.NOT_CONFIGURED', 'The integration has no saved bot token'),
        );
      }
      const opened = await cipher.decrypt(
        integrationSecretContext(
          context.current().organizationId,
          existing.id,
          BOT_TOKEN_FIELD,
          stored.secretVersion,
        ),
        stored.encrypted,
      );
      // Un token que no se abre es un fallo del servicio de llaves, no de la persona: se LANZA.
      if (!opened.ok) throw opened.error;

      let result: TelegramSendResult;
      try {
        result = await sender.send({
          botToken: textDecoder.decode(opened.value),
          chatId: existing.chatId,
          text: TEST_MESSAGE_TEXT,
        });
      } finally {
        opened.value.fill(0);
      }
      const outcome: TestSendOutcome = result.ok ? 'sent' : result.code;
      await audit.record({
        action: 'integration.test_sent',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: existing.id,
        outcome: result.ok ? 'success' : 'failure',
        reasonCode: result.ok ? null : result.code,
        ip: null,
        requestId: context.current().requestId,
        metadata: { kind: existing.kind, outcome },
      });
      return ok(outcome);
    });
  }

  /**
   * Carga y bloquea la integración y exige el permiso de SU canal. Una integración que no existe en la
   * organización responde `NOT_FOUND`; una archivada no admite cambios.
   */
  private async loadManageable(
    integrationId: string,
  ): Promise<Result<IntegrationRecord, DomainError>> {
    const { authorizer, integrations } = this.deps;
    const integration = await integrations.findForUpdate(integrationId);
    if (integration === null) {
      return err(new DomainError('NOT_FOUND', 'Integration not found'));
    }
    const permission: Permission = TELEGRAM_KIND_PERMISSION[integration.kind];
    await authorizer.require({ permission });
    if (integration.status === 'archived') {
      return err(new DomainError('INTEGRATIONS.ARCHIVED', 'The integration is archived'));
    }
    return ok(integration);
  }

  /** Cifra con el contexto de la versión nueva. Un fallo se LANZA: devolver `err` confirmaría lo escrito. */
  private async storeBotToken(
    integrationId: string,
    secretVersion: number,
    botToken: string,
  ): Promise<void> {
    const { cipher, integrations, context, clock } = this.deps;
    const bytes = textEncoder.encode(botToken);
    let encrypted;
    try {
      encrypted = await cipher.encrypt(
        integrationSecretContext(
          context.current().organizationId,
          integrationId,
          BOT_TOKEN_FIELD,
          secretVersion,
        ),
        bytes,
      );
    } finally {
      bytes.fill(0);
    }
    if (!encrypted.ok) throw encrypted.error;
    await integrations.putSecret({
      integrationId,
      field: BOT_TOKEN_FIELD,
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

/** Solo el nombre del campo inválido; nunca su valor (puede ser el token o un dato personal). */
function invalidInput(field: string): Result<never, DomainError> {
  return err(new DomainError('VALIDATION.FAILED', 'Invalid integration input', { field }));
}
