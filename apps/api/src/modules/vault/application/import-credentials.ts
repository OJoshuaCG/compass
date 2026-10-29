/**
 * Importación de credenciales desde un CSV, en dos pasos: previsualizar (sin escribir nada) y confirmar.
 *
 * Invariantes de seguridad
 * - Permiso por el motor de autorización del módulo de acceso: hacen falta `account.create` y
 *   `credential.create`, porque importar crea cuentas y credenciales nuevas. La guarda del controlador no
 *   decide nada. Una negación queda auditada por el motor (`authz.denied`) y no se procesa el contenido.
 * - El archivo se procesa en memoria: el texto del CSV no se guarda, no se audita y no viaja en ningún
 *   error ni respuesta. La previsualización devuelve plataforma, nombre de cuenta y etiqueta (datos que
 *   ya viven en claro en la bóveda) y NUNCA el usuario ni la contraseña de la plataforma.
 * - Solo el módulo de criptografía cifra: cada usuario y contraseña pasa por `storeCredentialSecret`, el
 *   mismo camino que crear una credencial a mano.
 * - Todo o nada: con una sola fila inválida no se escribe nada. Todo ocurre en una transacción de la
 *   organización; quien importa recibe MANAGE sobre cada cuenta nueva (BO-4), igual que al crearla a mano.
 * - Un único evento de auditoría por importación (`credential.imported`, solo conteos) y es lo ÚLTIMO que
 *   escribe la transacción (ADR 0023): auditar cada fila retendría el bloqueo de la cadena de auditoría
 *   durante el cifrado de hasta 500 filas.
 */
import type {
  CredentialImportPreview,
  CredentialImportResult,
  CredentialImportRow,
  CredentialImportRowErrorCode,
  Permission,
} from '@iam/contracts';

import { DomainError, ok } from '../../../shared/kernel/index.js';
import type {
  IdGenerator,
  RequestContextReader,
  Result,
  UserId,
} from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { readImportFile, validateImportRow } from '../domain/credential-csv.js';
import type { ImportRow } from '../domain/credential-csv.js';
import type { AccountRepository, PlatformRecord } from './ports/account-repository.js';
import type { CredentialRepository } from './ports/credential-repository.js';
import { storeCredentialSecret } from './store-credential-secret.js';

export interface ImportCredentialsDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly accounts: AccountRepository;
  readonly credentials: CredentialRepository;
  readonly cipher: SecretCipher;
  readonly audit: AuditLog;
  readonly ids: IdGenerator;
}

/** Confirmar con filas inválidas no escribe nada y devuelve el informe para que la persona las corrija. */
export type ImportCommitOutcome =
  | { readonly status: 'imported'; readonly result: CredentialImportResult }
  | { readonly status: 'rejected'; readonly preview: CredentialImportPreview };

/** Importar crea cuentas y credenciales: se exigen los dos permisos del catálogo. */
const REQUIRED_PERMISSIONS: readonly Permission[] = ['account.create', 'credential.create'];

const FIRST_VERSION = 1;

/** Lo que se devuelve de una celda inválida se acota: el archivo puede traer un valor de 1 MB. */
const ECHO_MAX_LENGTH = 200;

const KEY_SEPARATOR = '\u0000';

const normalized = (value: string): string => value.toLowerCase();
const accountKeyOf = (platformId: string, accountName: string): string =>
  `${platformId}${KEY_SEPARATOR}${normalized(accountName)}`;
const echo = (value: string): string => value.slice(0, ECHO_MAX_LENGTH);

interface AnalyzedRow {
  readonly source: ImportRow;
  readonly view: CredentialImportRow;
  /** Plataforma resuelta; solo las filas válidas la necesitan. */
  readonly platformId: string | null;
}

interface Analysis {
  readonly rows: readonly AnalyzedRow[];
  readonly preview: CredentialImportPreview;
}

export class ImportCredentials {
  constructor(private readonly deps: ImportCredentialsDeps) {}

  /** Valida el archivo y dice qué pasaría al confirmar. No escribe nada. */
  preview(csv: string): Promise<Result<CredentialImportPreview, DomainError>> {
    const { uow } = this.deps;
    return uow.run(async () => {
      const actorId = await this.authorizeImport();
      const analysis = await this.analyze(csv, actorId);
      if (!analysis.ok) return analysis;
      return ok(analysis.value.preview);
    });
  }

  /** Crea cuentas y credenciales de las filas válidas; si alguna fila es inválida, no crea nada. */
  commit(csv: string): Promise<Result<ImportCommitOutcome, DomainError>> {
    const { context, uow, accounts, credentials, cipher, audit, ids } = this.deps;
    return uow.run(async () => {
      const actorId = await this.authorizeImport();
      const requestId = context.current().requestId;
      const analysis = await this.analyze(csv, actorId);
      if (!analysis.ok) return analysis;
      const { rows, preview } = analysis.value;

      if (preview.invalidRows > 0) return ok({ status: 'rejected', preview });

      // Las filas válidas de una misma cuenta (misma plataforma y nombre) comparten una sola cuenta nueva.
      const rowsByAccount = new Map<string, AnalyzedRow[]>();
      for (const row of rows) {
        if (row.view.status !== 'valid' || row.platformId === null) continue;
        const key = accountKeyOf(row.platformId, row.source.accountName);
        const group = rowsByAccount.get(key) ?? [];
        group.push(row);
        rowsByAccount.set(key, group);
      }

      let credentialsCreated = 0;
      for (const group of rowsByAccount.values()) {
        const first = group[0];
        if (first === undefined || first.platformId === null) continue;
        const account = await accounts.insert({
          id: ids.next(),
          platformId: first.platformId,
          displayName: first.source.accountName,
          handle: null,
          ownerGroupId: null,
          tags: [],
          createdBy: actorId,
        });
        await accounts.insertUserShare({
          id: ids.next(),
          accountId: account.id,
          userId: actorId,
          level: 'MANAGE',
          grantedBy: actorId,
        });
        for (const row of group) {
          const credential = await credentials.insertCredential({
            id: ids.next(),
            accountId: account.id,
            label: row.source.credentialLabel,
            kind: 'password',
            createdBy: actorId,
          });
          const storage = { context, credentials, cipher, ids };
          await storeCredentialSecret(storage, {
            credentialId: credential.id,
            field: 'username',
            version: FIRST_VERSION,
            plaintext: row.source.username,
            blindIndexPurpose: 'platform-username',
            createdBy: actorId,
          });
          await storeCredentialSecret(storage, {
            credentialId: credential.id,
            field: 'password',
            version: FIRST_VERSION,
            plaintext: row.source.password,
            blindIndexPurpose: null,
            createdBy: actorId,
          });
          credentialsCreated += 1;
        }
      }

      const result: CredentialImportResult = {
        accountsCreated: rowsByAccount.size,
        credentialsCreated,
        duplicatesSkipped: preview.duplicateRows,
      };
      // Último paso de la transacción (ADR 0023). Solo conteos: ni nombres ni contenido del archivo.
      await audit.record({
        action: 'credential.imported',
        actorId,
        targetType: null,
        targetId: null,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId,
        metadata: { ...result },
      });
      return ok({ status: 'imported', result });
    });
  }

  /** Permisos del motor; devuelve quién importa. Lanza (y el motor audita) si no está permitido. */
  private async authorizeImport(): Promise<UserId> {
    const { context, authorizer } = this.deps;
    for (const permission of REQUIRED_PERMISSIONS) {
      await authorizer.require({ permission });
    }
    const actorId = context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }

  /** Lee el archivo y clasifica cada fila como válida, inválida o duplicada. No escribe nada. */
  private async analyze(csv: string, actorId: UserId): Promise<Result<Analysis, DomainError>> {
    const { accounts } = this.deps;
    const file = readImportFile(csv);
    if (!file.ok) return file;

    const platformIndex = buildPlatformIndex(await accounts.listPlatforms());
    const wellFormed = file.value.filter((row) => row.shapeOk && row.accountName !== '');
    const existingKeys = new Set(
      (
        await accounts.findVisibleKeysByNames(actorId, [
          ...new Set(wellFormed.map((row) => row.accountName)),
        ])
      ).map((existing) => accountKeyOf(existing.platformId, existing.displayName)),
    );

    const seenCredentialKeys = new Set<string>();
    const rows: AnalyzedRow[] = file.value.map((source) => {
      const errors: CredentialImportRowErrorCode[] = validateImportRow(source);
      let platformId: string | null = null;
      if (source.shapeOk && source.platform !== '') {
        const match = platformIndex.get(normalized(source.platform));
        if (match === undefined) errors.push('PLATFORM_UNKNOWN');
        else if (match === null) errors.push('PLATFORM_AMBIGUOUS');
        else platformId = match;
      }

      let status: CredentialImportRow['status'] = 'valid';
      let duplicateReason: CredentialImportRow['duplicateReason'] = null;
      if (errors.length > 0 || platformId === null) {
        status = 'invalid';
      } else {
        const accountKey = accountKeyOf(platformId, source.accountName);
        const credentialKey = `${accountKey}${KEY_SEPARATOR}${normalized(source.credentialLabel)}`;
        if (existingKeys.has(accountKey)) {
          status = 'duplicate';
          duplicateReason = 'existing';
        } else if (seenCredentialKeys.has(credentialKey)) {
          status = 'duplicate';
          duplicateReason = 'in_file';
        } else {
          seenCredentialKeys.add(credentialKey);
        }
      }

      const view: CredentialImportRow = {
        line: source.line,
        status,
        errorCodes: errors,
        duplicateReason,
        // Una fila con otro número de celdas que la cabecera no se puede atribuir a columnas: no se devuelve.
        platform: source.shapeOk ? echo(source.platform) : '',
        accountName: source.shapeOk ? echo(source.accountName) : '',
        credentialLabel: source.shapeOk ? echo(source.credentialLabel) : '',
      };
      return { source, view, platformId };
    });

    const count = (status: CredentialImportRow['status']): number =>
      rows.filter((row) => row.view.status === status).length;
    return ok({
      rows,
      preview: {
        totalRows: rows.length,
        validRows: count('valid'),
        invalidRows: count('invalid'),
        duplicateRows: count('duplicate'),
        rows: rows.map((row) => row.view),
      },
    });
  }
}

/**
 * Plataformas por nombre y por `slug` (sin distinguir mayúsculas). Si un texto coincide con dos plataformas
 * distintas (una global y una propia con el mismo nombre), se marca ambiguo (`null`) en vez de elegir una.
 */
function buildPlatformIndex(
  platforms: readonly PlatformRecord[],
): ReadonlyMap<string, string | null> {
  const index = new Map<string, string | null>();
  for (const platform of platforms) {
    for (const key of new Set([normalized(platform.slug), normalized(platform.name)])) {
      const existing = index.get(key);
      index.set(key, existing === undefined || existing === platform.id ? platform.id : null);
    }
  }
  return index;
}
