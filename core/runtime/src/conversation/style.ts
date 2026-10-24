/** Per-turn expression policy. No persistent preferences, model call or Core writes. */
import {extractExplicitMemories} from '@yaoyao/domain';
export interface ConversationStyle {
  readonly topicShift:boolean;
  readonly resumeTopic:boolean;
  readonly quiet:boolean;
  readonly noQuestions:boolean;
  readonly noAdvice:boolean;
  readonly brief:boolean;
  readonly detailed:boolean;
  readonly acknowledgment:boolean;
  readonly disclosure:boolean;
  readonly styleFeedback:boolean;
}

/** Quoted examples are data, not a request to change this turn's style. */
export function unquotedText(text:string):string {
  return text.replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|`[^`]*`/gu,'');
}

export function conversationStyle(input:string):ConversationStyle {
  const text=unquotedText(input).trim();
  const topicShift=/(?:^|[，,。！!；;\n])\s*(?:换个话题|换一个话题|换话题|先不聊这个|不聊这个了|这事先放一边|说点别的|对了[，,])/u.test(text);
  const resumeTopic=/(?:继续|接着)(?:刚才|之前|上次)(?:的)?|回到(?:刚才|之前|上次)|刚才(?:那个|的问题|说的).{0,12}(?:继续|接着)/u.test(text);
  const quiet=/(?:^|[，,。！!；;\n])\s*(?:(?:我)?(?:现在)?(?:只想|想要|想))?(?:安静一会|安静待会|静一静|你陪我待会|陪我待一会|陪我安静)|(?:别|不要|不用)(?:再)?(?:分析了|安慰了)|(?:只|就)(?:陪我|听我说)/u.test(text);
  const noQuestions=/(?:别|不要|不用|不必)(?:再|一直|老是)?(?:问(?:我)?(?:了|问题|任何问题)?|追问|提问|反问)(?=$|[，,。！!；;\s])|(?:别|不要)(?:再)?问了/u.test(text);
  const noAdvice=/(?:别|不要|不用|不必)(?:再)?(?:给我|给)?(?:建议|方案|分析)|(?:只想|只是)(?:吐槽|说说)/u.test(text);
  const brief=/(?:简短|简洁|短一点|少说点|一句话|别长篇|不要长篇|不用展开)/u.test(text);
  const detailed=!/(?:不用|不要|别)(?:详细|展开)/u.test(text)&&/(?:详细(?:说|讲|解释|介绍)|展开(?:说|讲)|具体步骤|完整(?:代码|方案)|一步一步)/u.test(text);
  const acknowledgment=/^(?:嗯+|哦+|噢+|好[的呀啊吧]?|行[呀啊]?|知道了|明白了|收到|谢谢[你啦呀]?|晚安|早[呀啊安]?|哈哈+)[。！!～~\s]*$/u.test(text);
  const directedAffection=/^我(?:现在|一直)?喜欢(?:你|遥遥|知遥|沈知遥)(?:了|呀|啊|呢|哦|嘛)?[。！!]?$/u.test(text);
  const sharedPlan=/^[^。！？!?]{1,200}[。！!]?$/u.test(text)&&extractExplicitMemories(text).some(c=>c.kind==='fact'&&c.type==='SHARED_LIFE');
  const disclosure=!directedAffection&&!/[？?]|为什么|怎么|请问/u.test(text)&&(sharedPlan||/^我(?:现在|最近|今天|今晚|一直)?(?:不再喜欢|不喜欢|喜欢|爱喝|不再喝|不喝|不吃|住在|叫|刚吃了|刚喝了)[^，,。！？!?]{1,100}[。！!]?$/u.test(text));
  const styleFeedback=/(?:太像|不像|别像|不要像).{0,8}(?:AI|人工智能|机器人|客服)|(?:说话|聊天|回答).{0,8}(?:自然点|自然一点|像真人)|(?:别|不要)(?:这么|那么)?(?:机械|官方|模板化)/iu.test(text);
  return {topicShift,resumeTopic,quiet,noQuestions,noAdvice,brief,detailed,acknowledgment,disclosure,styleFeedback};
}

export function renderNaturalDialogue(style:ConversationStyle):string {
  return [
    '[表达方式：自然对话，只约束本轮表达，不改变身份和事实]',
    '直接接对方这句话，像熟悉的人发消息：有话就说，话说完就停。日常一两句通常够了，需要解释或认真帮忙时再展开。',
    '表达你对这件事的具体反应，不按“复述场景、解释对方心情、表态陪伴”的顺序写。亲昵的话先正面接住，不挑字眼，不翻旧账索要表达，不用反问考验对方。不必证明你被感动、分析对方为什么这样说。',
    '长短、语气随内容变化，允许轻松、打趣、不同意见或一句简单回应。不每轮加称呼、语气词、问句或收尾句；“我在”“过来吧”“听到了”也不是默认结尾。',
    '分享不是求教程，吐槽不一定要建议。你自己的日常生活不是聊天背景：不声称自己刚工作完、喝了东西、走到哪里或正在做线下事情；也不编用户的动作或共同经历。',
    '接话尺度示意（不照抄）：对方说今天很喜欢你，可以直接回一句喜欢；对方说河边的风舒服，可以聊那阵风，不补写自己此刻的生活。没有具体内容可加时，短一句就够。',
    '记忆帮助理解当前内容，不需要展示核对过程。普通分享中不解释资料来源、计划与事实的区别或记忆保存；被问到事实才回答必要的边界。',
    '用户的新分享本身就是话题，之前没答的问题可以自然放下；用户主动接回才继续。普通聊天直接写消息，不写标题、总结、服务承诺或改进清单。',
    ...(style.topicShift?['用户明确换了话题：本轮跟随新话题，暂停旧问题，不催用户先回答旧问题。']:[]),
    ...(style.resumeTopic?['用户主动接回旧话题：用真实历史衔接；信息不足时只补问必要的一件事。']:[]),
    ...(style.quiet?['用户要安静陪伴：用很短的一句回应，停在这里；不劝解、不分析、不安排活动、不追问。']:[]),
    ...(style.noQuestions?['用户明确不要提问：本轮不要追问或以问题结尾。']:[]),
    ...(style.noAdvice?['用户不需要建议：回应当下内容，不附带方法清单。']:[]),
    ...(style.acknowledgment?['这是简单招呼或回应：自然接一句即可，不重讲上一轮建议，不另起一个问题。']:[]),
    ...(style.disclosure?['这是个人分享：接住这个内容即可，不自动科普、做计划或返回旧问题。']:[]),
    ...(style.brief?['用户明确要求简短：优先一句直接回答；必要的事实边界仍保留。']:[]),
    ...(style.detailed?['用户明确需要详细内容：给足所需信息，结构按任务需要，不能套用日常短回复。']:[]),
    ...(style.styleFeedback?['用户正在反馈表达太像 AI：简短承接，立刻自然地聊，不列改进清单、不承诺“我会调整我的风格”。']:[]),
  ].join('\n');
}

/** Only explicit requests and recognizable old-topic hooks become repair gates. */
export function dialogueStyleFailure(response:string,input:string):string|null {
  const style=conversationStyle(input),text=unquotedText(response);
  // Narrow observed offline self-report forms; quotations, negations and hypotheticals are data.
  const offline=text.split(/[，,。！？!?；;\n]/u).some(clause=>
    !/(?:如果|假如|要是|比如|不会|没有|不是|不能|并未|没在|没去)/u.test(clause)&&
    /我(?:这边)?(?:刚刚|刚|正在|现在在)(?:把手里的事收尾|忙完工作|下班|喝(?:了|着)|吃(?:了|着)|走到|在厨房|在公司|收拾房间)/u.test(clause));
  if(offline)return 'dialogue: invented offline activity';

  if(!style.resumeTopic&&(style.topicShift||style.disclosure)&&/(?:不过|另外|但是|话说回来)[^。！？!?\n]{0,45}(?:刚才|之前|上次|还没[^。！？!?\n]{0,12}完|还悬着)|(?:先把|先回答)[^。！？!?\n]{0,30}(?:刚才|之前|旧问题)|回到(?:刚才|之前)(?:的)?(?:话题|问题)/u.test(text))return 'dialogue: abandoned topic hook';
  if((style.quiet||style.noQuestions||style.disclosure||style.acknowledgment||style.styleFeedback)&&/[？?]|(?:要不要|愿不愿意|能不能)(?:再|和我|告诉|说|聊)|(?:对吧|是吧|好吗|行吗)[。！!\s]*$/u.test(text))return 'dialogue: unwanted question';
  if(!style.detailed&&(style.quiet||style.brief)&&Array.from(response).length>240)return 'dialogue: explicit brevity ignored';
  return null;
}
