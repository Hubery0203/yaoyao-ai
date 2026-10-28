import type {ConversationTurn} from '@yaoyao/application';

/** Keep media in dialogue while excluding it from literal `User: ` fact evidence. */
export function renderHistoryTurn(turn:ConversationTurn):string {
 if(turn.role==='assistant')return 'YaoYao: '+turn.text;
 if(turn.attachment==='voice')return 'Voice transcript (User; unconfirmed recognition): '+turn.text;
 if(turn.attachment==='image')return 'Image input (User; caption is not an asserted fact): '+turn.text;
 return 'User: '+turn.text;
}
