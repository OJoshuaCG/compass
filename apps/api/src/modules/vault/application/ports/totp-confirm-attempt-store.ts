/**
 * Cuenta los fallos al confirmar un registro pendiente del segundo factor. La llave identifica el registro
 * (credencial y versión del secreto), no a la persona: quien registró de nuevo empieza con la cuenta en cero.
 *
 * Los contadores viven en memoria del proceso hasta que haya Redis (igual que los intentos de ingreso):
 * se asume una sola instancia de la API y un reinicio los pone en cero.
 */
export interface TotpConfirmAttemptStore {
  failures(key: string): Promise<number>;
  recordFailure(key: string): Promise<void>;
  clear(key: string): Promise<void>;
}
