import type {UserId} from '@yaoyao/domain';
import type {PersistenceTransaction} from '../ports/persistence/transactions.js';
import {findCompletedTurn,persistAssistantMessage,persistUserMessage} from './conversation.js';
/** Only operation status is recorded, never an invented physical activity or image prompt as a fact. */
export async function recordPhotoResponse(tx:PersistenceTransaction,input:{userId:UserId;text:string;requestId:string;reply:string}):Promise<string>{
 const {yaoyaoId}=await tx.aggregates.loadOwned(input.userId);
 await tx.continuity.lockTurn(input.userId,yaoyaoId,input.requestId);
 const prior=await findCompletedTurn(tx,{...input,yaoyaoId});if(prior!==null)return prior;
 const data={...input,yaoyaoId,sessionId:null,traceId:input.requestId};
 await persistUserMessage(tx,data);await persistAssistantMessage(tx,{...data,text:input.reply});return input.reply;
}
