/**
 * ConversationEventPort adapter — MVP-002G.
 *
 * Implements the application-defined ConversationEventPort by running the
 * conversation use cases inside TransactionManager.runAsUser.
 * Each method is its own transaction (the Tx1/Tx2 design):
 *   Tx1: persistUserMessage (+ Step 8 STATE_CHANGED in the orchestrator's
 *        emotion writer, same turn)
 *   Tx2: persistAssistantMessage (after response delivery)
 */
import {
  CONVERSATION_EVENTS,
  TRANSACTION_MANAGER,
  findCompletedTurn,
  loadConversationHistory,
  persistAssistantMessage,
  persistUserMessage,
  type ConversationEventPort,
  type ConversationTurn,
  type PersistMessageInput,
  type TransactionManager,
} from "@yaoyao/application";
import { Inject, Injectable } from "@nestjs/common";

export { CONVERSATION_EVENTS };

@Injectable()
export class TransactionalConversationEvents implements ConversationEventPort {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManager,
  ) {}

  async persistUserMessage(
    input: PersistMessageInput,
  ): Promise<{ eventId: string; duplicate: boolean }> {
    return this.transactions.runAsUser(input.userId, (tx) =>
      persistUserMessage(tx, input),
    );
  }

  async persistAssistantMessage(
    input: PersistMessageInput,
  ): Promise<{ eventId: string }> {
    return this.transactions.runAsUser(input.userId, (tx) =>
      persistAssistantMessage(tx, input),
    );
  }

  async loadHistory(input: {
    userId: PersistMessageInput["userId"];
    yaoyaoId: PersistMessageInput["yaoyaoId"];
    limit: number;
  }): Promise<ReadonlyArray<ConversationTurn>> {
    return this.transactions.runAsUser(input.userId, (tx) =>
      loadConversationHistory(tx, input),
    );
  }

  async findCompletedTurn(input: {
    userId: PersistMessageInput["userId"];
    yaoyaoId: PersistMessageInput["yaoyaoId"];
    requestId: string;
  }): Promise<string | null> {
    return this.transactions.runAsUser(input.userId, (tx) =>
      findCompletedTurn(tx, input),
    );
  }
}
