/**
 * Invariantes de seguridad
 * - Este adaptador es solo para desarrollo: SE NIEGA A ARRANCAR con NODE_ENV=production.
 * - La KEK local vive en un archivo ignorado por git, con permisos 0600; nunca se registra.
 * - La DEK se envuelve con el id de la organización como AAD: una DEK de la organización A
 *   no se puede abrir pidiendo la B (equivalente al contexto de cifrado de AWS KMS).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CryptoPrimitives } from '../application/ports/crypto-primitives.js';
import type {
  GeneratedDataKey,
  KeyManagementPort,
} from '../application/ports/key-management-port.js';
import { utf8 } from '../domain/blind-index.js';
import { NodeCryptoPrimitives } from './node-crypto-primitives.js';

const KEK_LENGTH = 32;
const NONCE_LENGTH = 12;
const KEY_REF = 'local:v1';

export interface LocalKeyManagementOptions {
  readonly keyFilePath: string;
  /** Normalmente `process.env.NODE_ENV`; se inyecta para poder probar la negativa. */
  readonly nodeEnv: string | undefined;
  readonly primitives?: CryptoPrimitives;
}

export class LocalKeyManagement implements KeyManagementPort {
  private readonly primitives: CryptoPrimitives;
  private readonly kek: Uint8Array;

  constructor(options: LocalKeyManagementOptions) {
    if (options.nodeEnv === 'production') {
      throw new Error('LocalKeyManagement refuses to start when NODE_ENV=production');
    }
    this.primitives = options.primitives ?? new NodeCryptoPrimitives();
    this.kek = this.loadOrCreateKek(options.keyFilePath);
  }

  generateDataKey(input: { readonly organizationId: string }): Promise<GeneratedDataKey> {
    const plaintext = this.primitives.randomBytes(KEK_LENGTH);
    const nonce = this.primitives.randomBytes(NONCE_LENGTH);
    const sealed = this.primitives.aesGcmEncrypt({
      key: this.kek,
      nonce,
      aad: this.aad(input.organizationId),
      plaintext,
    });
    const wrapped = new Uint8Array(nonce.length + sealed.length);
    wrapped.set(nonce, 0);
    wrapped.set(sealed, nonce.length);
    return Promise.resolve({ plaintext, wrapped, keyRef: KEY_REF });
  }

  decryptDataKey(input: {
    readonly organizationId: string;
    readonly wrapped: Uint8Array;
    readonly keyRef: string;
  }): Promise<Uint8Array> {
    if (input.keyRef !== KEY_REF) {
      return Promise.reject(new Error('Unknown local key reference'));
    }
    try {
      return Promise.resolve(
        this.primitives.aesGcmDecrypt({
          key: this.kek,
          nonce: input.wrapped.subarray(0, NONCE_LENGTH),
          aad: this.aad(input.organizationId),
          ciphertext: input.wrapped.subarray(NONCE_LENGTH),
        }),
      );
    } catch {
      return Promise.reject(new Error('Data key could not be unwrapped'));
    }
  }

  private aad(organizationId: string): Uint8Array {
    return utf8(`iam/local-kms/v1|${organizationId}`);
  }

  private loadOrCreateKek(path: string): Uint8Array {
    mkdirSync(dirname(path), { recursive: true });
    try {
      // `wx`: creación exclusiva. Si dos procesos arrancan a la vez, solo uno escribe la KEK y el
      // otro la lee; sobrescribirla dejaría sin abrir las DEK que ya envolvió el primero.
      writeFileSync(path, this.primitives.randomBytes(KEK_LENGTH), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const key = new Uint8Array(readFileSync(path));
    if (key.length !== KEK_LENGTH) throw new Error('Local KEK file has an invalid length');
    return key;
  }
}
