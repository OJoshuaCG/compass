/** Fachada pública del módulo `crypto`. Solo lo exportado aquí puede importarse desde otros módulos. */
export { DataKeyResolver } from './application/data-key-resolver.js';
export { DekCache } from './application/dek-cache.js';
export type { CryptoPrimitives } from './application/ports/crypto-primitives.js';
export type { DataKeyRepository, DataKeyRecord } from './application/ports/data-key-repository.js';
export type { KeyManagementPort } from './application/ports/key-management-port.js';
export { SecretCipher } from './application/secret-cipher.js';
export type { BlindIndexValue } from './application/secret-cipher.js';
export type { BlindIndexPurpose } from './domain/blind-index.js';
export type { EncryptedSecret, SecretContext } from './domain/secret-context.js';
export { AwsKeyManagement } from './infrastructure/aws-key-management.js';
export { LocalKeyManagement } from './infrastructure/local-key-management.js';
export { NodeCryptoPrimitives } from './infrastructure/node-crypto-primitives.js';
export { PgDataKeyRepository } from './infrastructure/pg-data-key-repository.js';
export { sha256Hex } from './infrastructure/sha256.js';
