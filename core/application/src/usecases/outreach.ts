import {DomainEvent,type UserId} from '@yaoyao/domain';
import type {PersistenceTransaction} from '../ports/persistence/transactions.js';
/** Record only accepted/owner-confirmed outbound text. No fabricated USER_MESSAGE or memory job. */
export async function recordAcceptedOutreach(tx:PersistenceTransaction,input:{userId:UserId;key:string;text:string}):Promise<void>{
 const aggregate=await tx.aggregates.loadOwned(input.userId),requestId='weixin-outreach-'+input.key;
 await tx.continuity.lockTurn(input.userId,aggregate.yaoyaoId,requestId);
 const events=tx.events.readWindow?(await tx.events.readWindow(input.userId,aggregate.yaoyaoId,{requestId,types:['ASSISTANT_MESSAGE'],limit:1})).events:await tx.events.readOwnedAfter(input.userId,aggregate.yaoyaoId,0);
 if(events.some(e=>e.event.type==='ASSISTANT_MESSAGE'&&e.event.correlationId===requestId))return;
 await tx.events.append({event:DomainEvent.create({type:'ASSISTANT_MESSAGE',actor:'YAOYAO',source:'CORE',userId:input.userId,yaoyaoId:aggregate.yaoyaoId,sessionId:null,payload:{text:input.text,channel:'weixin',origin:'proactive'},correlationId:requestId})});
}
