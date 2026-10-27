import type { RequestContext, RequestContextRunner, Result } from '../../../shared/kernel/index.js';
import type { TenantScope, ScopeContext } from '../application/ports/tenant-scope.js';
import type { UnitOfWork } from '../application/ports/unit-of-work.js';

/** Señal interna para revertir una transacción cuando el resultado es un error esperado. */
class RollbackSignal<E> extends Error {
  constructor(readonly outcome: { readonly ok: false; readonly error: E }) {
    super('rollback');
    this.name = 'RollbackSignal';
  }
}

export class PgTenantScope implements TenantScope {
  constructor(
    private readonly contexts: RequestContextRunner,
    private readonly uow: UnitOfWork,
  ) {}

  runAs<T>(context: ScopeContext, fn: () => Promise<T>): Promise<T> {
    return this.contexts.run(toContext(context), () => this.uow.run(fn));
  }

  async runAsAtomic<T, E>(
    context: ScopeContext,
    fn: () => Promise<Result<T, E>>,
  ): Promise<Result<T, E>> {
    try {
      return await this.runAs(context, async () => {
        const result = await fn();
        if (!result.ok) throw new RollbackSignal<E>(result);
        return result;
      });
    } catch (error) {
      if (error instanceof RollbackSignal) return error.outcome;
      throw error;
    }
  }
}

const toContext = (context: ScopeContext): RequestContext => ({
  organizationId: context.organizationId,
  actorId: context.actorId,
  requestId: context.requestId,
  sessionId: context.sessionId ?? null,
  reauthAt: context.reauthAt ?? null,
});
