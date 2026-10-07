/**
 * EmotionStateWriter adapter — MVP-002E.
 *
 * Implements the application-defined EmotionStateWriter port by running the
 * applyEmotionProposal use case inside TransactionManager.runAsUser:
 * load → domain transition → CAS → STATE_CHANGED → commit, atomically.
 *
 * Lives in apps/api (wiring layer): it connects the @yaoyao/application
 * port to the @yaoyao/application transaction manager. It contains no
 * business logic — just composition.
 *
 * I-016: this adapter never talks to an LLM. It receives validated deltas
 * and persists the domain-computed state. Proposal ≠ State.
 */
import {
  applyEmotionProposal,
  EMOTION_STATE_WRITER,
  TRANSACTION_MANAGER,
  type EmotionStateWriter,
  type EmotionWritebackInput,
  type EmotionWritebackResult,
  type TransactionManager,
} from "@yaoyao/application";
import { Inject, Injectable } from "@nestjs/common";

export { EMOTION_STATE_WRITER };

@Injectable()
export class TransactionalEmotionWriter implements EmotionStateWriter {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
  ) {}

  async writeback(
    input: EmotionWritebackInput,
  ): Promise<EmotionWritebackResult> {
    return this.transactions.runAsUser(input.userId, (tx) =>
      applyEmotionProposal(tx, input),
    );
  }
}
