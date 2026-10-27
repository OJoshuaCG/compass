/**
 * Unidad de trabajo: todo lo que corre dentro de `run` comparte una sola transacción de base
 * de datos con `app.org_id` fijado a la organización del `RequestContext`. Si algo lanza, se
 * revierte todo (acción, auditoría y eventos de outbox juntos).
 */
export interface UnitOfWork {
  run<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Como `run`, pero SIEMPRE en una transacción nueva y propia (no se une a la del llamador), que
   * se confirma al terminar `fn` aunque la del llamador se revierta después. Es para efectos que
   * deben sobrevivir a un rollback ajeno (por ejemplo, crear la primera DEK de una organización).
   * Consume una segunda conexión del pool mientras dura: úsese solo en caminos raros.
   */
  runIndependent<T>(fn: () => Promise<T>): Promise<T>;
}
