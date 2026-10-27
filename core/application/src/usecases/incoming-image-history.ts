import type {UserId} from '@yaoyao/domain';
import type {PersistenceTransaction} from '../ports/persistence/transactions.js';
import {findCompletedTurn,loadConversationHistory,persistAssistantMessage,persistUserMessage} from './conversation.js';
/** Owner-scoped, bounded context; no memories, credentials, full history or image bytes go to the vision provider. */
export async function incomingImageContext(tx:PersistenceTransaction,userId:UserId,requestId:string):Promise<ReadonlyArray<{role:'user'|'assistant';text:string}>>{
 const {yaoyaoId}=await tx.aggregates.loadOwned(userId);
 return (await loadConversationHistory(tx,{userId,yaoyaoId,limit:6,excludeRequestId:requestId})).map(t=>({role:t.role,text:t.text.slice(0,250)}));
}
/** The image caption and actual final response are history, never an asserted memory/life event. */
export async function recordIncomingImageResponse(tx:PersistenceTransaction,input:{userId:UserId;text:string;requestId:string;reply:string}):Promise<string>{
 const {yaoyaoId}=await tx.aggregates.loadOwned(input.userId);
 await tx.continuity.lockTurn(input.userId,yaoyaoId,input.requestId);
 const prior=await findCompletedTurn(tx,{...input,yaoyaoId});if(prior!==null)return prior;
 const data={...input,yaoyaoId,sessionId:null,traceId:input.requestId,attachment:'image' as const};
 await persistUserMessage(tx,data);await persistAssistantMessage(tx,{...data,text:input.reply});return input.reply;
}
