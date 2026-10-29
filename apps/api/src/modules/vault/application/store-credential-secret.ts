/**
 * Cifra un campo de una credencial y lo guarda con su índice ciego (usuario) o su huella (contraseña).
 *
 * Vive aparte para que crear una credencial suelta (`ManageCredentials`) y la importación por CSV
 * (`ImportCredentials`) compartan EXACTAMENTE el mismo camino de cifrado: el texto en claro solo se
 * entrega al módulo de criptografía y nunca se guarda, se audita ni se registra.
 */
import type { RequestContextReader, UserId } from '../../../shared/kernel/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { CredentialRepository, SecretField } from './ports/credential-repository.js';

export interface SecretStorageDeps {
  readonly context: RequestContextReader;
  readonly credentials: CredentialRepository;
  readonly cipher: SecretCipher;
  readonly ids: { next(): string };
}

export interface StoreSecretInput {
  readonly credentialId: string;
  readonly field: SecretField;
  readonly version: number;
  readonly plaintext: string;
  /** Solo el usuario se busca por valor exacto; la contraseña guarda su huella, no un índice. */
  readonly blindIndexPurpose: 'platform-username' | null;
  readonly createdBy: UserId;
}

const textEncoder = new TextEncoder();

/**
 * Si la criptografía falla LANZA el error en vez de devolverlo: la unidad de trabajo solo revierte
 * ante una excepción, y devolver un `err` confirmaría una credencial a medias o una contraseña
 * retirada sin versión nueva ni auditoría.
 */
export async function storeCredentialSecret(
  deps: SecretStorageDeps,
  input: StoreSecretInput,
): Promise<void> {
  const { context, credentials, cipher, ids } = deps;
  const organizationId = context.current().organizationId;

  const bytes = textEncoder.encode(input.plaintext);
  let encrypted;
  try {
    encrypted = await cipher.encrypt(
      {
        organizationId,
        resourceId: input.credentialId,
        field: input.field,
        version: input.version,
      },
      bytes,
    );
  } finally {
    bytes.fill(0);
  }
  if (!encrypted.ok) throw encrypted.error;

  // El índice y la huella se calculan con la MISMA versión de DEK del texto cifrado: al rotar la
  // clave se recalculan juntos (ADR 0040).
  const dekVersion = encrypted.value.dekVersion;
  let blindIndexHex: string | null = null;
  if (input.blindIndexPurpose !== null) {
    const blind = await cipher.blindIndex(
      organizationId,
      input.blindIndexPurpose,
      input.plaintext,
      dekVersion,
    );
    if (!blind.ok) throw blind.error;
    blindIndexHex = blind.value.index;
  }

  await credentials.insertSecret({
    id: ids.next(),
    credentialId: input.credentialId,
    field: input.field,
    version: input.version,
    ciphertext: encrypted.value.ciphertext,
    nonce: encrypted.value.nonce,
    dekVersion,
    blindIndexHex,
    createdBy: input.createdBy,
  });

  if (input.field === 'password') {
    const fingerprint = await cipher.blindIndex(
      organizationId,
      'password-fingerprint',
      input.plaintext,
      dekVersion,
    );
    if (!fingerprint.ok) throw fingerprint.error;
    await credentials.upsertPasswordFingerprint(input.credentialId, fingerprint.value.index);
  }
}
