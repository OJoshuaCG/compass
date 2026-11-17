/**
 * Salud de las credenciales de una cuenta (señales informativas, nunca bloquean).
 *
 * Invariantes de seguridad
 * - Solo quien ya tiene acceso efectivo a la cuenta la consulta; sin acceso responde NOT_FOUND, igual que la ficha.
 * - Solo expone señales y el puntaje: ni el secreto, ni la huella, ni el texto cifrado.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Result } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { evaluateCredentialHealth } from '../domain/credential-health.js';
import type { CredentialHealth } from '../domain/credential-health.js';
import type { AccountRepository } from './ports/account-repository.js';
import type { CredentialHealthReader } from './ports/credential-health-reader.js';

export interface GetAccountHealthDeps {
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly accounts: Pick<AccountRepository, 'effectiveLevel' | 'findById'>;
  readonly health: CredentialHealthReader;
  readonly clock: { now(): Date };
}

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Account not found');

export class GetAccountHealth {
  constructor(private readonly deps: GetAccountHealthDeps) {}

  execute(accountId: string): Promise<Result<readonly CredentialHealth[], DomainError>> {
    const { uow, authorizer, accounts, health, clock } = this.deps;
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      const level = await accounts.effectiveLevel(accountId, actor.id);
      if (level === null) return err(notFound());
      const account = await accounts.findById(accountId);
      if (account === null || account.status !== 'active') {
        return err(notFound());
      }

      const now = clock.now();
      const facts = await health.factsByAccount(accountId);
      return ok(facts.map((entry) => evaluateCredentialHealth(entry, now)));
    });
  }
}
