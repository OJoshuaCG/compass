import type { DirectoryUser, Rank, RootTransfer } from '@iam/contracts';

/** Rango de la Raíz: la única persona que puede proponer el traspaso. */
const ROOT_RANK: Rank = 0;
/** Rango de los Administradores: los únicos que pueden recibir el puesto. */
const ADMINISTRATOR_RANK: Rank = 1;

/** Rol de quien mira la pantalla frente a la transferencia abierta (comodidad: el servidor decide). */
export type RootTransferViewer = 'root' | 'recipient' | 'administrator';

/**
 * Quién es quien consulta respecto de la transferencia. La persona destinataria se reconoce por su
 * identificador aunque sea Administradora: es la única que puede aceptar.
 */
export function rootTransferViewer(
  rank: Rank,
  userId: string,
  transfer: RootTransfer | null,
): RootTransferViewer {
  if (rank === ROOT_RANK) return 'root';
  if (transfer !== null && transfer.toUserId === userId) return 'recipient';
  return 'administrator';
}

/** Solo la Raíz propone, y solo cuando no hay otra transferencia abierta. */
export function canPropose(viewer: RootTransferViewer, transfer: RootTransfer | null): boolean {
  return viewer === 'root' && transfer === null;
}

/** Solo la persona destinataria acepta, y solo mientras la propuesta espera su respuesta. */
export function canAccept(viewer: RootTransferViewer, transfer: RootTransfer): boolean {
  return viewer === 'recipient' && transfer.status === 'pending_acceptance';
}

/**
 * Administradores a quienes se puede proponer el puesto: rango 1 y distintos de quien propone. Es
 * comodidad de la UI; el servidor exige que la persona esté activa (`ROOT_TRANSFER.TARGET_NOT_ELIGIBLE`).
 */
export function eligibleTargets(people: readonly DirectoryUser[], selfId: string): DirectoryUser[] {
  return people.filter((person) => person.rank === ADMINISTRATOR_RANK && person.id !== selfId);
}

/** Nombre de una persona del directorio visible, o `undefined` si no se pudo cargar. */
export function personName(people: readonly DirectoryUser[], id: string): string | undefined {
  return people.find((person) => person.id === id)?.displayName;
}
