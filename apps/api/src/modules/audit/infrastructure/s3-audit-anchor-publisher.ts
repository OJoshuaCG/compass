/**
 * Invariantes de seguridad
 * - Cada manifiesto se escribe con Object Lock en modo de cumplimiento (`COMPLIANCE`) y una fecha de retención:
 *   durante ese plazo nadie, ni la cuenta dueña del bucket, borra ni sobrescribe esa versión (ADR 0042).
 * - Usa una credencial propia, de solo escritura, distinta de la de los respaldos, de la base y del KMS. Se
 *   recibe explícita y no por la cadena por defecto del SDK, para que nunca se use por error la de AWS KMS.
 * - Nunca registra la credencial ni el detalle del servicio: el error que sale solo trae el nombre del error
 *   del SDK (p. ej. `AccessDenied`), que sirve para operar y no lleva datos.
 * - Cada llamada tiene un tiempo máximo: el trabajo sostiene una transacción mientras publica.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { AuditAnchorPublisher } from '../application/ports/audit-anchor-ports.js';
import type { AuditAnchorManifest } from '../domain/audit-anchor.js';

/** Una escritura de un objeto pequeño tarda menos de un segundo; 15 s cubre los reintentos internos del SDK. */
export const AUDIT_ANCHOR_REQUEST_TIMEOUT_MS = 15_000;

const OBJECT_LOCK_MODE = 'COMPLIANCE';
const MANIFEST_CONTENT_TYPE = 'application/json';
const UNKNOWN_SDK_ERROR = 'Unknown';

/** Error de publicación sin detalle del servicio; `code` es el nombre del error del SDK. */
export class AuditAnchorPublishError extends Error {
  override readonly name = 'AuditAnchorPublishError';

  constructor(readonly code: string) {
    super('Audit anchor manifest could not be published');
  }
}

/** Lo único que usa el adaptador del almacenamiento; permite probarlo sin red ni credenciales. */
export interface AuditAnchorObjectOperations {
  putObject(input: {
    readonly bucket: string;
    readonly key: string;
    readonly body: string;
    readonly retainUntil: Date;
    readonly abortSignal: AbortSignal;
  }): Promise<void>;
}

export interface S3AuditAnchorPublisherOptions {
  readonly bucket: string;
  /** Extremo compatible con S3, p. ej. `https://s3.<región>.wasabisys.com`. */
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Solo para pruebas; en producción se crea el cliente real del SDK. */
  readonly operations?: AuditAnchorObjectOperations;
  readonly requestTimeoutMs?: number;
}

export class S3AuditAnchorPublisher implements AuditAnchorPublisher {
  private readonly bucket: string;
  private readonly operations: AuditAnchorObjectOperations;
  private readonly requestTimeoutMs: number;

  constructor(options: S3AuditAnchorPublisherOptions) {
    if (options.bucket.length === 0) throw new Error('S3AuditAnchorPublisher requires a bucket');
    this.bucket = options.bucket;
    this.requestTimeoutMs = options.requestTimeoutMs ?? AUDIT_ANCHOR_REQUEST_TIMEOUT_MS;
    this.operations = options.operations ?? createSdkOperations(options);
  }

  async publish(manifest: AuditAnchorManifest, retainUntil: Date): Promise<void> {
    try {
      await this.operations.putObject({
        bucket: this.bucket,
        key: manifest.objectKey,
        body: manifest.body,
        retainUntil,
        abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      const sdkErrorName = error instanceof Error ? error.name : UNKNOWN_SDK_ERROR;
      throw new AuditAnchorPublishError(sdkErrorName);
    }
  }
}

/** Lo único que usa el adaptador del cliente del SDK; permite probar el mapeo del comando sin red. */
export interface AuditAnchorS3Sender {
  send(command: PutObjectCommand, options: { readonly abortSignal: AbortSignal }): Promise<unknown>;
}

function createSdkOperations(options: S3AuditAnchorPublisherOptions): AuditAnchorObjectOperations {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    // Los proveedores compatibles con S3 aceptan siempre la ruta con el bucket; el subdominio por bucket
    // depende del proveedor y del nombre.
    forcePathStyle: true,
  });
  return createAnchorOperationsOn(client);
}

export function createAnchorOperationsOn(client: AuditAnchorS3Sender): AuditAnchorObjectOperations {
  return {
    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: MANIFEST_CONTENT_TYPE,
          ObjectLockMode: OBJECT_LOCK_MODE,
          ObjectLockRetainUntilDate: input.retainUntil,
        }),
        { abortSignal: input.abortSignal },
      );
    },
  };
}
