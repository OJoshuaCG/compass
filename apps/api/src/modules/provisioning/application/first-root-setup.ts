/**
 * Alta de la primera organización y de su Raíz desde el enlace único de configuración inicial (ADR 0046).
 *
 * Invariantes de seguridad
 * - Solo existe mientras NO haya ninguna organización. La comprobación se hace aquí y otra vez en la
 *   base de datos (`auth.create_first_organization` rechaza con SQLSTATE IAM01), así que un olvido o
 *   una carrera entre dos peticiones no puede crear una segunda organización.
 * - Sin `FIRST_SETUP_TOKEN` configurado, con el token equivocado o con el alta ya hecha, la respuesta
 *   es la misma `NOT_FOUND`: desde fuera no se distingue una ruta cerrada de una que no existe.
 * - El token se compara en tiempo constante, sobre digestos SHA-256.
 * - Nada de lo recibido se registra: ni el token, ni la contraseña, ni los códigos de emergencia.
 *   Solo se avisa del motivo del rechazo y de la IP, porque un intento fallido no puede auditarse en
 *   la base de datos (la auditoría es por organización y todavía no hay ninguna).
 */
import { ErrorCode } from '@iam/contracts';

import { evaluatePassword, passwordProblemToError, personalTokens } from '../../identity/index.js';
import type { PasswordStrength } from '../../identity/index.js';
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Result } from '../../../shared/kernel/index.js';
import type { BootstrapOrganization } from './bootstrap-organization.js';
import type { CustodyGroup } from './emergency-codes.js';

/** SQLSTATE con el que la base de datos rechaza el alta porque ya existe una organización. */
const FIRST_ORGANIZATION_EXISTS_SQLSTATE = 'IAM01';

export type FirstSetupRejection = 'not_configured' | 'wrong_token' | 'already_completed';

export interface FirstSetupInput {
  readonly token: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly rootEmail: string;
  readonly rootDisplayName: string;
  readonly password: string;
}

export interface FirstSetupResult {
  readonly organizationId: string;
  /** Se muestran UNA vez; cada uno lleva el custodio que lo conserva (ADR 0037). */
  readonly emergencyCodes: readonly {
    readonly code: string;
    readonly custodyGroup: CustodyGroup;
  }[];
}

export class FirstRootSetup {
  constructor(
    private readonly deps: {
      /** Valor de `FIRST_SETUP_TOKEN`; `undefined` deja la ruta cerrada. */
      readonly configuredToken: string | undefined;
      /** `auth.list_organization_ids()`: basta saber si hay alguna. */
      readonly organizations: { listIds(): Promise<readonly unknown[]> };
      readonly bootstrap: BootstrapOrganization;
      readonly strength: PasswordStrength;
      readonly sha256: (data: Uint8Array) => Uint8Array;
      readonly constantTimeEquals: (left: Uint8Array, right: Uint8Array) => boolean;
      /** Aviso operativo de un rechazo: solo motivo e IP, nunca el token ni el cuerpo. */
      readonly onRejected: (event: {
        readonly reason: FirstSetupRejection;
        readonly ip: string;
      }) => void;
    },
  ) {}

  async execute(
    input: FirstSetupInput,
    clientIp: string,
  ): Promise<Result<FirstSetupResult, DomainError>> {
    const rejection = await this.findRejection(input.token);
    if (rejection !== null) {
      this.deps.onRejected({ reason: rejection, ip: clientIp });
      return err(notFound());
    }

    const email = input.rootEmail.trim().toLowerCase();
    const tokens = personalTokens(email, input.rootDisplayName);
    const problem = evaluatePassword({
      password: input.password,
      score: this.deps.strength.score(input.password, tokens),
      personalTokens: tokens,
    });
    if (problem !== null) return err(passwordProblemToError(problem));

    try {
      const result = await this.deps.bootstrap.execute(
        {
          name: input.organizationName,
          slug: input.organizationSlug,
          rootEmail: email,
          rootDisplayName: input.rootDisplayName,
          rootPassword: input.password,
        },
        // La contraseña la eligió la propia persona: no tiene sentido obligarla a cambiarla al entrar.
        { rootPasswordMustChange: false },
      );
      return ok({
        organizationId: result.organizationId,
        emergencyCodes: result.emergencyCodes.map((code, index) => ({
          code,
          custodyGroup: result.emergencyCodeGroups[index] ?? 'A',
        })),
      });
    } catch (error) {
      if (isFirstOrganizationExists(error)) {
        // Otra petición ganó la carrera entre la comprobación y el alta.
        this.deps.onRejected({ reason: 'already_completed', ip: clientIp });
        return err(notFound());
      }
      throw error;
    }
  }

  private async findRejection(token: string): Promise<FirstSetupRejection | null> {
    const { configuredToken } = this.deps;
    if (configuredToken === undefined) return 'not_configured';
    if (!this.tokenMatches(token, configuredToken)) return 'wrong_token';
    const organizations = await this.deps.organizations.listIds();
    return organizations.length > 0 ? 'already_completed' : null;
  }

  private tokenMatches(received: string, configured: string): boolean {
    const encoder = new TextEncoder();
    return this.deps.constantTimeEquals(
      this.deps.sha256(encoder.encode(received)),
      this.deps.sha256(encoder.encode(configured)),
    );
  }
}

/** Misma respuesta para ruta sin configurar, token equivocado y alta ya hecha. */
function notFound(): DomainError {
  return new DomainError(ErrorCode.NOT_FOUND, 'Not found');
}

function isFirstOrganizationExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === FIRST_ORGANIZATION_EXISTS_SQLSTATE
  );
}
