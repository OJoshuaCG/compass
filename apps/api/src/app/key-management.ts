import { AwsKeyManagement, LocalKeyManagement } from '../modules/crypto/index.js';
import type { KeyManagementPort } from '../modules/crypto/index.js';
import type { Config } from './config.js';

/**
 * Crea el adaptador de gestión de claves que pide la configuración. Lo comparten la API y el
 * recifrado para que ambos abran las DEK con el mismo KMS (ADR 0020).
 */
export function createKeyManagement(config: Config): KeyManagementPort {
  if (config.KMS_ADAPTER === 'aws') {
    // La configuración ya exige ambos valores con `aws`; esta comprobación estrecha el tipo.
    if (config.AWS_KMS_KEY_ID === undefined || config.AWS_REGION === undefined) {
      throw new Error('AWS_KMS_KEY_ID and AWS_REGION are required with KMS_ADAPTER=aws');
    }
    return new AwsKeyManagement({ keyId: config.AWS_KMS_KEY_ID, region: config.AWS_REGION });
  }
  return new LocalKeyManagement({
    keyFilePath: config.LOCAL_KMS_KEY_FILE,
    nodeEnv: config.NODE_ENV,
  });
}

/**
 * Comprueba al arrancar que el KMS de producción responde y que la identidad de la API tiene permiso
 * de generar y abrir DEK. El adaptador local no tiene permisos que verificar: su clave se lee del
 * archivo al construirlo. Lanza un error genérico: el detalle de AWS no debe llegar a los registros.
 */
export async function verifyKeyManagementAccess(kms: KeyManagementPort): Promise<void> {
  if (!(kms instanceof AwsKeyManagement)) return;
  try {
    await kms.verifyAccess();
  } catch {
    throw new Error('KMS access check failed');
  }
}
