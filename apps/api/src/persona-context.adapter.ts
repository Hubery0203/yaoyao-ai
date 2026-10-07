/**
 * ContextDataPort adapter — MVP-002B.
 *
 * Implements the application-defined ContextDataPort by composing the
 * existing MVP-001 read use cases (getYaoYaoIdentity, getRelationship,
 * getCurrentState, listEvents) inside a single read transaction.
 *
 * Lives in apps/api (wiring layer): it connects the @yaoyao/application
 * port to the @yaoyao/infrastructure transaction manager. It contains
 * no business logic — just composition.
 *
 * Read-only: uses runAsUser for a scoped read transaction; writes nothing.
 */
import {
  CONTEXT_DATA,
  getCurrentState,
  getRelationship,
  getYaoYaoIdentity,
  listEvents,
  TRANSACTION_MANAGER,
  type ContextDataPort,
  type PersonaData,
  type TransactionManager,
} from "@yaoyao/application";
import type { UserId } from "@yaoyao/domain";
import { Inject, Injectable } from "@nestjs/common";

export { CONTEXT_DATA };

@Injectable()
export class TransactionalContextDataAdapter implements ContextDataPort {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
  ) {}

  async loadPersonaData(userId: UserId): Promise<PersonaData> {
    return this.transactions.runAsUser(userId, async (tx) => {
      const [yaoyao, relationship, state, eventPage] = await Promise.all([
        getYaoYaoIdentity(tx, { userId }),
        getRelationship(tx, { userId }),
        getCurrentState(tx, { userId }),
        listEvents(tx, { userId, limit: 20 }),
      ]);
      return {
        yaoyao,
        relationship,
        state,
        // PersistedEvent wraps the DomainEvent; the runtime works with
        // the domain event itself.
        recentEvents: eventPage.events.map((p) => p.event),
      };
    });
  }
}
