/**
 * Invariantes de seguridad
 * - La KEK nunca sale de AWS KMS: aquí solo se pide generar y abrir DEK envueltas.
 * - El id de la organización viaja como contexto de cifrado: KMS rechaza abrir una DEK envuelta para
 *   la organización A si se pide con el contexto de la B (AAD autenticado por KMS).
 * - Las credenciales de AWS las resuelve el SDK (variables de entorno o rol IAM): este módulo no las
 *   lee, no las recibe y no las registra.
 * - Los errores que salen de aquí son genéricos: el detalle de AWS (ARN, cuenta, mensaje del servicio)
 *   no debe llegar a los registros de la petición ni a un cliente.
 * - Cada llamada a KMS tiene un tiempo máximo: una respuesta que no llega no debe colgar la petición.
 */
import { timingSafeEqual } from 'node:crypto';

import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';

import type {
  GeneratedDataKey,
  KeyManagementPort,
} from '../application/ports/key-management-port.js';

const DATA_KEY_LENGTH = 32;
const ENCRYPTION_CONTEXT_ORGANIZATION = 'organization_id';
/** Valor que nunca coincide con una organización real: la DEK de la sonda no sirve para abrir datos. */
const STARTUP_PROBE_CONTEXT = 'startup-probe';

/** KMS responde en decenas de milisegundos; 5 s cubre un reintento interno sin colgar la petición. */
export const AWS_KMS_REQUEST_TIMEOUT_MS = 5_000;

export interface AwsGeneratedDataKey {
  readonly plaintext: Uint8Array | undefined;
  readonly ciphertextBlob: Uint8Array | undefined;
  readonly keyId: string | undefined;
}

/** Superficie mínima de KMS que usa el adaptador; permite probarlo sin red ni credenciales. */
export interface AwsKmsOperations {
  generateDataKey(input: {
    readonly keyId: string;
    readonly encryptionContext: Readonly<Record<string, string>>;
    readonly abortSignal: AbortSignal;
  }): Promise<AwsGeneratedDataKey>;
  decrypt(input: {
    readonly keyId: string;
    readonly ciphertextBlob: Uint8Array;
    readonly encryptionContext: Readonly<Record<string, string>>;
    readonly abortSignal: AbortSignal;
  }): Promise<Uint8Array | undefined>;
}

export interface AwsKeyManagementOptions {
  /** Id, ARN o alias de la clave KMS que envuelve las DEK. */
  readonly keyId: string;
  readonly region: string;
  /** Solo para pruebas; en producción se crea el cliente real del SDK. */
  readonly operations?: AwsKmsOperations;
  readonly requestTimeoutMs?: number;
}

export class AwsKeyManagement implements KeyManagementPort {
  private readonly keyId: string;
  private readonly operations: AwsKmsOperations;
  private readonly requestTimeoutMs: number;

  constructor(options: AwsKeyManagementOptions) {
    if (options.keyId.length === 0) throw new Error('AwsKeyManagement requires a KMS key id');
    this.keyId = options.keyId;
    this.requestTimeoutMs = options.requestTimeoutMs ?? AWS_KMS_REQUEST_TIMEOUT_MS;
    this.operations = options.operations ?? createSdkOperations(options.region);
  }

  async generateDataKey(input: { readonly organizationId: string }): Promise<GeneratedDataKey> {
    let result: AwsGeneratedDataKey;
    try {
      result = await this.operations.generateDataKey({
        keyId: this.keyId,
        encryptionContext: this.encryptionContext(input.organizationId),
        abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw new Error('Data key could not be generated');
    }

    const { plaintext, ciphertextBlob, keyId } = result;
    if (
      plaintext === undefined ||
      ciphertextBlob === undefined ||
      ciphertextBlob.length === 0 ||
      keyId === undefined ||
      keyId.length === 0
    ) {
      // Si KMS devolvió la DEK pero la respuesta no sirve, la DEK en claro no debe quedar en memoria.
      plaintext?.fill(0);
      throw new Error('Data key response is incomplete');
    }
    if (plaintext.length !== DATA_KEY_LENGTH) {
      // Una DEK de otro tamaño no sirve para AES-256 y no debe llegar a cifrar nada.
      plaintext.fill(0);
      throw new Error('Data key response has an invalid length');
    }
    // `keyRef` guarda el ARN de la clave que envolvió la DEK (KMS lo devuelve aunque se configure un
    // alias), así la apertura apunta a esa clave aunque el alias cambie de destino después.
    return { plaintext, wrapped: ciphertextBlob, keyRef: keyId };
  }

  async decryptDataKey(input: {
    readonly organizationId: string;
    readonly wrapped: Uint8Array;
    readonly keyRef: string;
  }): Promise<Uint8Array> {
    if (input.keyRef.length === 0) throw new Error('Unknown key reference');

    let plaintext: Uint8Array | undefined;
    try {
      plaintext = await this.operations.decrypt({
        keyId: input.keyRef,
        ciphertextBlob: input.wrapped,
        encryptionContext: this.encryptionContext(input.organizationId),
        abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw new Error('Data key could not be unwrapped');
    }

    if (plaintext === undefined) throw new Error('Data key could not be unwrapped');
    if (plaintext.length !== DATA_KEY_LENGTH) {
      plaintext.fill(0);
      throw new Error('Data key could not be unwrapped');
    }
    return plaintext;
  }

  /**
   * Sonda de arranque: genera una DEK desechable y la abre de vuelta. Así una política IAM sin
   * `kms:GenerateDataKey` o sin `kms:Decrypt`, una clave deshabilitada o una región equivocada fallan al
   * arrancar y no con la primera petición de un usuario. La DEK de la sonda se borra de memoria y su
   * contexto de cifrado no pertenece a ninguna organización.
   */
  async verifyAccess(): Promise<void> {
    const generated = await this.generateDataKey({ organizationId: STARTUP_PROBE_CONTEXT });
    let opened: Uint8Array | undefined;
    try {
      opened = await this.decryptDataKey({
        organizationId: STARTUP_PROBE_CONTEXT,
        wrapped: generated.wrapped,
        keyRef: generated.keyRef,
      });
      if (!timingSafeEqual(opened, generated.plaintext)) {
        throw new Error('Data key round trip does not match');
      }
    } finally {
      generated.plaintext.fill(0);
      opened?.fill(0);
    }
  }

  private encryptionContext(organizationId: string): Readonly<Record<string, string>> {
    return { [ENCRYPTION_CONTEXT_ORGANIZATION]: organizationId };
  }
}

/** Lo único que usa el adaptador del cliente del SDK; permite probar el mapeo de comandos sin red. */
export interface AwsKmsSender {
  send(
    command: GenerateDataKeyCommand | DecryptCommand,
    options: { readonly abortSignal: AbortSignal },
  ): Promise<{
    Plaintext?: Uint8Array | undefined;
    CiphertextBlob?: Uint8Array | undefined;
    KeyId?: string | undefined;
  }>;
}

/** Cliente real: la cadena de credenciales por defecto del SDK (entorno, rol IAM) resuelve el acceso. */
function createSdkOperations(region: string): AwsKmsOperations {
  return createOperationsOn(new KMSClient({ region }));
}

export function createOperationsOn(client: AwsKmsSender): AwsKmsOperations {
  return {
    async generateDataKey(input) {
      const response = await client.send(
        new GenerateDataKeyCommand({
          KeyId: input.keyId,
          KeySpec: 'AES_256',
          EncryptionContext: { ...input.encryptionContext },
        }),
        { abortSignal: input.abortSignal },
      );
      return {
        plaintext: response.Plaintext,
        ciphertextBlob: response.CiphertextBlob,
        keyId: response.KeyId,
      };
    },
    async decrypt(input) {
      const response = await client.send(
        new DecryptCommand({
          KeyId: input.keyId,
          CiphertextBlob: input.ciphertextBlob,
          EncryptionContext: { ...input.encryptionContext },
        }),
        { abortSignal: input.abortSignal },
      );
      return response.Plaintext;
    },
  };
}
