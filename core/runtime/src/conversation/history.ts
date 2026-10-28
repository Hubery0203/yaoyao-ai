import {parseLifeChange,type CompanionExperienceContext,type ConversationTurn} from '@yaoyao/application';

/** Keep media in dialogue while excluding it from literal `User: ` fact evidence. */
export function renderHistoryTurn(turn:ConversationTurn):string {
 if(turn.role==='assistant')return 'YaoYao: '+turn.text;
 if(turn.attachment==='voice')return 'Voice transcript (User; unconfirmed recognition): '+turn.text;
 if(turn.attachment==='image')return 'Image input (User; caption is not an asserted fact): '+turn.text;
 return 'User: '+turn.text;
}

/** Source rules guide reasoning; they must not become explanatory chat tails. */
export function mediaHistoryGuidance(history:readonly ConversationTurn[]):string {
 if(!history.some(t=>t.role==='user'&&t.attachment))return '';
 return '[媒体历史接话]\nVoice transcript只表示识别得到的文字，不等于本人已确认，不能把它引用为“你自己说的”来断言居住地或生活结果；仅有这种来源就简短说不确定。Image input和助手旧描述可供接话，但当前没有旧图片像素，不能新增颜色、深浅、位置等画面细节，更不能声称闻到、尝到或碰到。\n本人当前或后续明确打字的纠正优先，直接接住纠正后的内容；不附带识别原理、历史来源或存储说明，不猜哪条识别错了，除非本人问原因。不要求重新发已讨论的图，只有实际需要重新看像素才说明。';
}

/** Narrow life-record queries cannot be answered affirmatively from recognition alone. */
export function unconfirmedMediaLifeSubject(input:string,history:readonly ConversationTurn[],context?:CompanionExperienceContext):string|null {
 const match=/^(?:我的|我|之前的|那次)?(面试|考试|出差|旅行|搬家|体检|开会|项目)(?:结束了吗|结束没|结束了没|完成了吗|完成没|取消了吗|开始了吗|怎么样了)[？?]?$/u.exec(input.trim());
 if(!match)return null;
 const subject=match[1];if(context?.lifeEvents.some(e=>e.subject===subject))return null;
 const statements=history.filter(t=>t.role==='user'&&parseLifeChange(t.text,t.occurredAt,t.timezone??'UTC')?.subject===subject);
 return statements.some(t=>t.attachment)&&!statements.some(t=>!t.attachment)?subject:null;
}

/** A narrow source-bound record reply, after validation; never a general media reply rewrite. */
export function groundedMediaLifeReply(input:string,history:readonly ConversationTurn[],context?:CompanionExperienceContext):string|null {
 const subject=unconfirmedMediaLifeSubject(input,history,context);
 return subject?'还不确定你的'+subject+'进展呢。':null;
}

export function hasAssertedMediaLifeOutcome(response:string,input:string,history:readonly ConversationTurn[],context?:CompanionExperienceContext):boolean {
 if(!unconfirmedMediaLifeSubject(input,history,context))return false;
 return response.split(/[，,。！？!?；;\n]/u).some(clause=>!/(?:不确定|不能确定|不知道|不清楚|是否|有没有|听到|识别|转写|假如|如果)/u.test(clause)&&/(?:结束了|完成了|取消了|开始了|已经结束|已经完成|还没结束|没有结束|尚未结束|你自己说的)/u.test(clause));
}
