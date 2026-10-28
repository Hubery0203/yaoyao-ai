import {parseLifeChange,type CompanionExperienceContext,type ConversationTurn} from '@yaoyao/application';
import {unquotedText} from './style.js';

/** Keep media in dialogue while excluding it from literal `User: ` fact evidence. */
export function renderHistoryTurn(turn:ConversationTurn):string {
 if(turn.role==='assistant')return 'YaoYao: '+turn.text;
 if(turn.attachment==='voice')return 'Voice transcript (User; unconfirmed recognition): '+turn.text;
 if(turn.attachment==='image')return 'Image input (User; caption is not an asserted fact): '+turn.text;
 return 'User: '+turn.text;
}

/** Source rules guide reasoning; they must not become explanatory chat tails. */
export function mediaHistoryGuidance(history:readonly ConversationTurn[],input=''):string {
 if(!history.some(t=>t.role==='user'&&t.attachment))return '';
 const correction=history.some(t=>t.role==='user'&&t.attachment==='image')&&/(?:刚才|刚刚).{0,30}(?:不是|看错|识别错)|不是.{1,20}[，,]?(?:是|而是)/u.test(input);
 return '[媒体历史接话]\nVoice transcript只表示识别得到的文字，不等于本人已确认，不能把它引用为“你自己说的”来断言居住地或生活结果；仅有这种来源就简短说不确定。Image input和助手旧描述可供接话，但当前没有旧图片像素，不能新增颜色、深浅、位置等画面细节，更不能声称闻到、尝到或碰到。\n本人当前或后续明确打字的纠正优先，直接接住纠正后的内容；不附带识别原理、历史来源或存储说明，不猜哪条识别错了，除非本人问原因。不要求重新发已讨论的图，只有实际需要重新看像素才说明。'+(correction?'\n本轮在纠正先前图片判断：只用一句短确认接住更正后的内容，然后停下。不要为看错找理由，也不要补充颜色、气味或其他画面评价。':'');
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
 return unquotedText(response).split(/[，,。！？!?；;\n]/u).some(clause=>!/(?:不确定|不能确定|不知道|不清楚|是否|有没有|听到|识别|转写|假如|如果)/u.test(clause)&&/(?:结束了|完成了|取消了|开始了|已经结束|已经完成|还没结束|没有结束|尚未结束|你自己说的)/u.test(clause));
}

/** A text follow-up has no old pixels: new color/depth claims need literal context. */
export function hasUnsupportedMediaDetail(response:string,input:string,history:readonly ConversationTurn[]):boolean {
 let start=-1;for(let i=history.length-1;i>=0;i--)if(history[i].role==='user'&&history[i].attachment==='image'){start=i;break;}
 if(start<0||/^(?:请|帮我)?(?:翻译|改写|写(?:个|一段|一篇|一个)?(?:故事|小说|对白))/u.test(input.trim()))return false;
 const evidence=[input,...history.slice(start).map(t=>t.text)].join('\n');
 for(const clause of unquotedText(response).split(/[，,。！？!?；;\n]/u)){
  if(/(?:如果|假如|要是|不确定|看不清|不能确定|不知道|看不到|无法看|不能看)/u.test(clause))continue;
  if(!/(?:这(?:杯|张|个)|图里|图片|照片|看着|看起来|颜色|色泽)/u.test(clause))continue;
  if(/颜色|色泽/u.test(clause)&&!/(?:颜色|色泽|[红蓝绿黄黑白紫橙棕灰粉]色)/u.test(evidence))return true;
  for(const match of clause.matchAll(/[红蓝绿黄黑白紫橙棕灰粉]色|(?:颜色|色泽)(?:挺|很|比较|有点|特别|偏)?(深|浅)/gu)){
   if(match[1]){if(!new RegExp('(?:颜色|色泽)(?:挺|很|比较|有点|特别|偏)?'+match[1],'u').test(evidence))return true;}
   else if(!evidence.includes(match[0]))return true;
  }
 }
 return false;
}
