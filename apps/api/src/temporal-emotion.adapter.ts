import { Inject, Injectable } from "@nestjs/common";
import { TRANSACTION_MANAGER, advanceTemporalEmotion, type TemporalEmotionWriter, type TransactionManager } from "@yaoyao/application";
import type { UserId } from "@yaoyao/domain";
@Injectable()
export class TransactionalTemporalEmotionWriter implements TemporalEmotionWriter {
  constructor(@Inject(TRANSACTION_MANAGER) private readonly manager:TransactionManager) {}
  async advance(userId:UserId,requestId:string):Promise<void> {
    await this.manager.runAsUser(userId,tx=>advanceTemporalEmotion(tx,userId,requestId));
  }
}
