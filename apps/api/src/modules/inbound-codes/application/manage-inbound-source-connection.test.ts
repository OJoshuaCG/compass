import { putInboundSourceConnectionRequestSchema } from '@iam/contracts';
import { describe, expect, it, vi } from 'vitest';

import { DomainError, asOrganizationId, asUserId, err, ok } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import { mailSourcePasswordContext } from '../domain/mail-source-password-context.js';
import { ManageInboundSourceConnection } from './manage-inbound-source-connection.js';
import type {
  InboundConfigurationRepository,
  SourceRecord,
} from './ports/inbound-configuration-repository.js';
import type {
  InboundSourceConnectionRepository,
  SourceConnectionRecord,
  SourceConnectionWrite,
} from './ports/inbound-source-connection-repository.js';

const ORGANIZATION_ID = asOrganizationId('0198eeee-0000-7000-8000-000000000001');
const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const SOURCE_ID = '0198bbbb-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-03T12:00:00Z');
const RECENT_REAUTH = new Date('2026-11-03T11:58:00Z');
const STALE_REAUTH = new Date('2026-11-03T11:50:00Z');
const PASSWORD = 'mailbox-password';

type Level = 'USE' | 'VIEW' | 'EDIT' | 'MANAGE' | null;

const sourceRecord: SourceRecord = {
  id: SOURCE_ID,
  channel: 'mail',
  address: 'codes@example.com',
  displayName: 'Codes',
  accountId: null,
  status: 'active',
  createdAt: NOW,
};

const existingConnection: SourceConnectionRecord = {
  sourceId: SOURCE_ID,
  host: 'imap.example.com',
  port: 993,
  tlsMode: 'tls',
  username: 'codes@example.com',
  authservId: 'mx.example.com',
  acceptedRecipients: ['codes@example.com'],
  hasPassword: true,
  secretVersion: 4,
  updatedAt: NOW,
};

const sameEndpointInput = {
  host: 'imap.example.com',
  port: 993,
  tlsMode: 'tls' as const,
  username: 'codes@example.com',
  authservId: 'mx.example.com',
};

interface HarnessOptions {
  readonly level?: Level;
  readonly channel?: 'mail' | 'sms';
  readonly sourceExists?: boolean;
  readonly existing?: SourceConnectionRecord | null;
  readonly userEmails?: number;
  readonly reauthAt?: Date | null;
  readonly encryptFails?: boolean;
}

function buildHarness(options: HarnessOptions = {}) {
  const require = vi.fn(() => Promise.resolve([]));
  const auditDenial = vi.fn(() => Promise.resolve());
  const auditRecord = vi.fn((event: { action: string }) => Promise.resolve(ok(event as never)));
  const existing = options.existing === undefined ? existingConnection : options.existing;
  const toRecord = (write: SourceConnectionWrite): SourceConnectionRecord => ({
    sourceId: write.sourceId,
    host: write.host,
    port: write.port,
    tlsMode: write.tlsMode,
    username: write.username,
    authservId: write.authservId,
    acceptedRecipients: write.acceptedRecipients,
    hasPassword:
      write.password.kind === 'set' ||
      (write.password.kind === 'keep' && existing?.hasPassword === true),
    secretVersion: write.secretVersion,
    updatedAt: NOW,
  });
  const insert = vi.fn((write: SourceConnectionWrite) => Promise.resolve(toRecord(write)));
  const update = vi.fn((write: SourceConnectionWrite) => Promise.resolve(toRecord(write)));
  const countUserEmails = vi.fn(() => Promise.resolve(options.userEmails ?? 0));
  const connections: InboundSourceConnectionRepository = {
    find: () => Promise.resolve(existing),
    findForUpdate: () => Promise.resolve(existing),
    countUserEmails,
    insert,
    update,
  };
  const source: SourceRecord = { ...sourceRecord, channel: options.channel ?? 'mail' };
  const configuration = {
    findSourceForUpdate: () => Promise.resolve(options.sourceExists === false ? null : source),
    findSource: () => Promise.resolve(options.sourceExists === false ? null : source),
    resourceLevel: () => Promise.resolve(options.level === undefined ? 'MANAGE' : options.level),
  } as unknown as InboundConfigurationRepository;
  const encrypt = vi.fn((_context: unknown, plaintext: Uint8Array) => {
    const copy = new Uint8Array(plaintext);
    encryptedPlaintexts.push(copy);
    capturedBuffers.push(plaintext);
    return Promise.resolve(
      options.encryptFails === true
        ? err(new DomainError('CRYPTO.KMS_UNAVAILABLE', 'No key'))
        : ok({ ciphertext: new Uint8Array([1, 2]), nonce: new Uint8Array([3]), dekVersion: 7 }),
    );
  });
  const encryptedPlaintexts: Uint8Array[] = [];
  const capturedBuffers: Uint8Array[] = [];
  const useCase = new ManageInboundSourceConnection({
    context: {
      current: () => ({
        organizationId: ORGANIZATION_ID,
        actorId: ACTOR_ID,
        requestId: 'req-1',
        sessionId: null,
        reauthAt: options.reauthAt === undefined ? RECENT_REAUTH : options.reauthAt,
      }),
    },
    uow: {
      run: <T>(fn: () => Promise<T>) => fn(),
      runIndependent: <T>(fn: () => Promise<T>) => fn(),
    },
    authorizer: { require, auditDenial } as unknown as Authorizer,
    configuration,
    connections,
    cipher: { encrypt } as unknown as SecretCipher,
    audit: { record: auditRecord },
    clock: { now: () => NOW },
  });
  return {
    useCase,
    require,
    auditDenial,
    auditRecord,
    insert,
    update,
    encrypt,
    countUserEmails,
    encryptedPlaintexts,
    capturedBuffers,
  };
}

function auditedFields(harness: ReturnType<typeof buildHarness>): string {
  const event = harness.auditRecord.mock.calls[0]?.[0] as unknown as {
    metadata: { changedFields: string };
  };
  return event.metadata.changedFields;
}

describe('ManageInboundSourceConnection.put', () => {
  it('pide inbound.configure antes de todo', async () => {
    const harness = buildHarness();

    await harness.useCase.put(SOURCE_ID, sameEndpointInput);

    expect(harness.require).toHaveBeenCalledWith({ permission: 'inbound.configure' });
  });

  it('crea la conexión con la dirección de la fuente como destinatario y versión 1', async () => {
    const harness = buildHarness({ existing: null, level: 'EDIT' });

    const result = await harness.useCase.put(SOURCE_ID, {
      ...sameEndpointInput,
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
    const write = harness.insert.mock.calls[0]?.[0];
    expect(write?.acceptedRecipients).toEqual(['codes@example.com']);
    expect(write?.secretVersion).toBe(1);
    expect(write?.password.kind).toBe('set');
    expect(harness.update).not.toHaveBeenCalled();
    expect(auditedFields(harness)).toBe('connection,password');
  });

  it('cifra con el contexto de la versión nueva y borra el búfer en claro', async () => {
    const harness = buildHarness();

    await harness.useCase.put(SOURCE_ID, { ...sameEndpointInput, password: PASSWORD });

    expect(harness.encrypt.mock.calls[0]?.[0]).toEqual(
      mailSourcePasswordContext(ORGANIZATION_ID, SOURCE_ID, 5),
    );
    expect(new TextDecoder().decode(harness.encryptedPlaintexts[0])).toBe(PASSWORD);
    expect([...(harness.capturedBuffers[0] ?? [])].every((byte) => byte === 0)).toBe(true);
    expect(harness.update.mock.calls[0]?.[0].secretVersion).toBe(5);
  });

  it('una contraseña sin reautenticación reciente se rechaza sin escribir', async () => {
    const harness = buildHarness({ reauthAt: STALE_REAUTH });

    await expect(
      harness.useCase.put(SOURCE_ID, { ...sameEndpointInput, password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'AUTHZ.REAUTH_REQUIRED' });
    expect(harness.auditDenial).toHaveBeenCalledWith({
      code: 'AUTHZ.REAUTH_REQUIRED',
      permission: 'inbound.configure',
      targetSourceId: SOURCE_ID,
    });
    expect(harness.encrypt).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it('una contraseña sin ninguna reautenticación también se rechaza', async () => {
    const harness = buildHarness({ reauthAt: null });

    await expect(
      harness.useCase.put(SOURCE_ID, { ...sameEndpointInput, password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'AUTHZ.REAUTH_REQUIRED' });
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('sin contraseña nueva y sin reautenticación conserva la guardada si el destino no cambia', async () => {
    const harness = buildHarness({ reauthAt: null });

    const result = await harness.useCase.put(SOURCE_ID, {
      ...sameEndpointInput,
      authservId: 'mx2.example.com',
    });

    expect(result.ok).toBe(true);
    const write = harness.update.mock.calls[0]?.[0];
    expect(write?.password.kind).toBe('keep');
    expect(write?.secretVersion).toBe(4);
    expect(auditedFields(harness)).toBe('authservId');
  });

  it.each([
    ['host', { host: 'imap.attacker.example' }],
    ['port', { port: 143, tlsMode: 'starttls' as const }],
    ['username', { username: 'other@example.com' }],
  ])(
    'cambiar %s sin contraseña nueva borra la guardada y sube la versión',
    async (_field, change) => {
      const harness = buildHarness();

      const result = await harness.useCase.put(SOURCE_ID, { ...sameEndpointInput, ...change });

      expect(result.ok).toBe(true);
      const write = harness.update.mock.calls[0]?.[0];
      expect(write?.password.kind).toBe('clear');
      expect(write?.secretVersion).toBe(5);
      expect(auditedFields(harness)).toContain('passwordCleared');
      expect(harness.encrypt).not.toHaveBeenCalled();
    },
  );

  it('cambiar el destino trayendo contraseña nueva la guarda en vez de borrarla', async () => {
    const harness = buildHarness();

    await harness.useCase.put(SOURCE_ID, {
      ...sameEndpointInput,
      host: 'imap2.example.com',
      password: PASSWORD,
    });

    const write = harness.update.mock.calls[0]?.[0];
    expect(write?.password.kind).toBe('set');
    expect(auditedFields(harness)).toBe('host,password');
  });

  it('cambiar los destinatarios con EDIT se niega, se audita y no escribe', async () => {
    const harness = buildHarness({ level: 'EDIT' });

    const result = await harness.useCase.put(SOURCE_ID, {
      ...sameEndpointInput,
      acceptedRecipients: ['codes@example.com', 'alias@example.com'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ.SHARE');
    expect(harness.auditDenial).toHaveBeenCalledWith(
      expect.objectContaining({ targetSourceId: SOURCE_ID }),
    );
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it('con MANAGE cambia los destinatarios, en minúsculas y sin duplicados', async () => {
    const harness = buildHarness({ level: 'MANAGE' });

    const result = await harness.useCase.put(SOURCE_ID, {
      ...sameEndpointInput,
      acceptedRecipients: ['Alias@Example.com', 'alias@example.com', 'codes@example.com'],
    });

    expect(result.ok).toBe(true);
    expect(harness.update.mock.calls[0]?.[0].acceptedRecipients).toEqual([
      'alias@example.com',
      'codes@example.com',
    ]);
    expect(auditedFields(harness)).toBe('acceptedRecipients');
  });

  it('reenviar la misma lista con EDIT no cuenta como cambio', async () => {
    const harness = buildHarness({ level: 'EDIT' });

    const result = await harness.useCase.put(SOURCE_ID, {
      ...sameEndpointInput,
      acceptedRecipients: ['CODES@example.com'],
    });

    expect(result.ok).toBe(true);
    expect(harness.auditDenial).not.toHaveBeenCalled();
  });

  it('un destinatario que es el correo de una persona se rechaza sin escribir', async () => {
    const harness = buildHarness({ userEmails: 1 });

    const result = await harness.useCase.put(SOURCE_ID, {
      ...sameEndpointInput,
      acceptedRecipients: ['person@example.com'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INBOUND.RECIPIENT_NOT_ALLOWED');
    expect(harness.countUserEmails).toHaveBeenCalledWith(['person@example.com']);
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it('VIEW sobre la fuente no basta: AUTHZ.SHARE y auditoría de la negación', async () => {
    const harness = buildHarness({ level: 'VIEW' });

    const result = await harness.useCase.put(SOURCE_ID, sameEndpointInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ.SHARE');
    expect(harness.auditDenial).toHaveBeenCalledTimes(1);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('sin nivel sobre la fuente responde NOT_FOUND y audita', async () => {
    const harness = buildHarness({ level: null });

    const result = await harness.useCase.put(SOURCE_ID, sameEndpointInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(harness.auditDenial).toHaveBeenCalledTimes(1);
  });

  it('una fuente inexistente o archivada responde NOT_FOUND', async () => {
    const harness = buildHarness({ sourceExists: false });

    const result = await harness.useCase.put(SOURCE_ID, sameEndpointInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('una fuente de SMS no tiene conexión IMAP: NOT_FOUND sin escribir', async () => {
    const harness = buildHarness({ channel: 'sms', existing: null });

    const result = await harness.useCase.put(SOURCE_ID, {
      ...sameEndpointInput,
      password: PASSWORD,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.encrypt).not.toHaveBeenCalled();
  });

  it('un fallo de cifrado se lanza para revertir y no se audita éxito', async () => {
    const harness = buildHarness({ encryptFails: true });

    await expect(
      harness.useCase.put(SOURCE_ID, { ...sameEndpointInput, password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'CRYPTO.KMS_UNAVAILABLE' });
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
    expect([...(harness.capturedBuffers[0] ?? [])].every((byte) => byte === 0)).toBe(true);
  });

  it('la auditoría no lleva contraseña, host, usuario ni direcciones', async () => {
    const harness = buildHarness({ level: 'MANAGE' });

    await harness.useCase.put(SOURCE_ID, {
      ...sameEndpointInput,
      host: 'imap2.example.com',
      acceptedRecipients: ['alias@example.com'],
      password: PASSWORD,
    });

    const serialized = JSON.stringify(harness.auditRecord.mock.calls[0]?.[0]);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('imap2.example.com');
    expect(serialized).not.toContain('alias@example.com');
    expect(serialized).not.toContain('codes@example.com');
  });
});

describe('ManageInboundSourceConnection.get', () => {
  it('devuelve la conexión con EDIT', async () => {
    const harness = buildHarness({ level: 'EDIT' });

    const result = await harness.useCase.get(SOURCE_ID);

    expect(result).toEqual(ok(existingConnection));
  });

  it('pide inbound.configure y no lee la conexión de una fuente de SMS', async () => {
    const harness = buildHarness({ channel: 'sms' });

    const result = await harness.useCase.get(SOURCE_ID);

    expect(harness.require).toHaveBeenCalledWith({ permission: 'inbound.configure' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('con USE se niega y se audita', async () => {
    const harness = buildHarness({ level: 'USE' });

    const result = await harness.useCase.get(SOURCE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ.SHARE');
    expect(harness.auditDenial).toHaveBeenCalledTimes(1);
  });
});

describe('putInboundSourceConnectionRequestSchema', () => {
  it.each([
    [{ port: 993, tlsMode: 'starttls' }],
    [{ port: 143, tlsMode: 'tls' }],
    [{ port: 25, tlsMode: 'tls' }],
  ])('rechaza un puerto que no corresponde al modo TLS: %o', (change) => {
    const parsed = putInboundSourceConnectionRequestSchema.safeParse({
      ...sameEndpointInput,
      ...change,
    });

    expect(parsed.success).toBe(false);
  });

  it.each(['10.0.0.1', '192.168.1.10', 'localhost', 'imap..example.com'])(
    'rechaza el host %s (IP literal, sin dominio o mal formado)',
    (host) => {
      const parsed = putInboundSourceConnectionRequestSchema.safeParse({
        ...sameEndpointInput,
        host,
      });

      expect(parsed.success).toBe(false);
    },
  );

  it('normaliza el host a minúsculas, como exige la base', () => {
    const parsed = putInboundSourceConnectionRequestSchema.safeParse({
      ...sameEndpointInput,
      host: ' IMAP.Example.com ',
    });

    expect(parsed.success && parsed.data.host).toBe('imap.example.com');
  });

  it('rechaza más de 10 destinatarios', () => {
    const parsed = putInboundSourceConnectionRequestSchema.safeParse({
      ...sameEndpointInput,
      acceptedRecipients: Array.from(
        { length: 11 },
        (_unused, index) => `a${String(index)}@example.com`,
      ),
    });

    expect(parsed.success).toBe(false);
  });

  it('acepta 993 con TLS y 143 con STARTTLS', () => {
    expect(putInboundSourceConnectionRequestSchema.safeParse(sameEndpointInput).success).toBe(true);
    expect(
      putInboundSourceConnectionRequestSchema.safeParse({
        ...sameEndpointInput,
        port: 143,
        tlsMode: 'starttls',
      }).success,
    ).toBe(true);
  });
});
