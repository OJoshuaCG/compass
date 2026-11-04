/**
 * Reemisión de los códigos de emergencia de la Raíz tras una transferencia (ADR 0048). Comando de
 * operaciones: se ejecuta con una conexión de administración y nunca desde la API.
 *
 * Invariantes de seguridad
 * - Solo emite cuando la Raíz no tiene NINGÚN código de emergencia vigente: no sustituye en silencio unos
 *   códigos que dos custodios todavía conservan (para eso existe la recuperación, ADR 0037).
 * - El reparto es el de siempre: la mitad exacta para cada grupo de custodia (`issueEmergencyCodes`).
 * - Los códigos solo existen en memoria y en la salida del comando; a la base y a la auditoría llegan
 *   únicamente hashes y conteos.
 */
import { issueEmergencyCodes } from './emergency-codes.js';
import type {
  CustodyGroup,
  EmergencyCodePrimitives,
  IssuedEmergencyCode,
} from './emergency-codes.js';

export const EMERGENCY_CODE_REISSUE_REJECTED = 'EMERGENCY_CODE_REISSUE_REJECTED';

export class EmergencyCodeReissueRejectedError extends Error {
  readonly code = EMERGENCY_CODE_REISSUE_REJECTED;

  constructor() {
    super(
      'The reissue was rejected: the organization has no single active Root, or live emergency codes still exist.',
    );
    this.name = 'EmergencyCodeReissueRejectedError';
  }
}

export interface ActiveRootIdentity {
  readonly organizationId: string;
  readonly rootUserId: string;
}

export interface EmergencyCodeReissuePlan {
  readonly root: ActiveRootIdentity;
  readonly newEmergencyCodes: readonly {
    readonly hash: Uint8Array;
    readonly custodyGroup: CustodyGroup;
  }[];
}

export interface EmergencyCodeReissueStore {
  /** La única Raíz ACTIVA de la organización, o `null` si no hay una sola. */
  findActiveRoot(organizationSlug: string): Promise<ActiveRootIdentity | null>;
  /** Atómico: comprueba que no haya códigos vigentes, inserta los nuevos y audita. `false` = rechazado. */
  reissue(plan: EmergencyCodeReissuePlan): Promise<boolean>;
}

export interface ReissueEmergencyCodesDeps {
  readonly store: EmergencyCodeReissueStore;
  readonly primitives: EmergencyCodePrimitives;
}

export interface EmergencyCodeReissueResult {
  readonly rootUserId: string;
  readonly emergencyCodes: readonly string[];
  /** Custodio de cada código de `emergencyCodes`, en el mismo orden. */
  readonly emergencyCodeGroups: readonly CustodyGroup[];
}

export class ReissueEmergencyCodes {
  constructor(private readonly deps: ReissueEmergencyCodesDeps) {}

  async execute(input: { readonly organizationSlug: string }): Promise<EmergencyCodeReissueResult> {
    const root = await this.deps.store.findActiveRoot(input.organizationSlug);
    if (root === null) throw new EmergencyCodeReissueRejectedError();

    const issued: IssuedEmergencyCode[] = issueEmergencyCodes(this.deps.primitives);
    const accepted = await this.deps.store.reissue({
      root,
      newEmergencyCodes: issued.map(({ hash, custodyGroup }) => ({ hash, custodyGroup })),
    });
    if (!accepted) throw new EmergencyCodeReissueRejectedError();

    return {
      rootUserId: root.rootUserId,
      emergencyCodes: issued.map((item) => item.code),
      emergencyCodeGroups: issued.map((item) => item.custodyGroup),
    };
  }
}
