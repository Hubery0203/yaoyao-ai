import type {UserId} from '@yaoyao/domain';
import type {PersistenceTransaction} from '../ports/persistence/transactions.js';
import {findCompletedTurn,persistUserMessage,persistAssistantMessage} from './conversation.js';
/** Failures/control previews are honest status history, not a second model conversation. */
export async function recordIncomingAudioResponse(tx:PersistenceTransaction,input:{userId:UserId;text:string;requestId:string;reply:string}):Promise<string>{
 const {yaoyaoId}=await tx.aggregates.loadOwned(input.userId);await tx.continuity.lockTurn(input.userId,yaoyaoId,input.requestId);
 const prior=await findCompletedTurn(tx,{...input,yaoyaoId});if(prior!==null)return prior;
 const data={...input,yaoyaoId,sessionId:null,traceId:input.requestId,attachment:'voice' as const};await persistUserMessage(tx,data);await persistAssistantMessage(tx,{...data,text:input.reply});return input.reply;
}
