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
  readonly briefAffection:boolean;
  readonly affectionateClosing:boolean;
  readonly casualShare:boolean;
  readonly farewell:boolean;
}

/** Quoted examples are data, not a request to change this turn's style. */
export function unquotedText(text:string):string {
  return text.replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|`[^`]*`/gu,'');
}

export function isSuggestionRefusal(input:string):boolean {
 return /(?:^|[，,。！？!?；;\n])\s*(?:别|不要|不用)(?:再)?(?:建议|推荐)/u.test(unquotedText(input));
}
export function resolvedShortChoice(input:string,recent:readonly string[]):boolean {
 const last=recent.filter(t=>t.startsWith('YaoYao: ')).at(-1)??'',answer=unquotedText(input).trim().replace(/[吧呀啊呢。！!\s]+$/u,'');
 return input.length<=12&&answer.length>0&&!/[？?]|帮我|请问|为什么|怎么/u.test(input)&&/[？?]/u.test(last)&&(last.includes(answer)||/^(?:都行|随便|都可以|前者|后者|第[一二123]个)$/u.test(answer));
}
/** Explicit information/writing requests must not inherit casual-sharing brevity. */
export function isDialogueTask(input:string):boolean {
 const text=unquotedText(input);
 return /[？?]|为什么|怎么办|怎么做|如何|帮我|请问|求助|(?:解释|分析|翻译|改写)(?:一下|下|这|那|一段)|(?:给我|帮忙)(?:写|查|算|列|分析)|(?:请|麻烦)(?:你)?(?:写|查|算|列|解释|分析)/u.test(text);
}
export function isDirectNatureQuestion(input:string):boolean {
 return /^(?:遥遥[，, ]*)?你(?:到底|究竟)?(?:是|是不是)(?:一个|个)?(?:AI|人工智能|真人|机器人)(?:(?:还是|或)(?:AI|人工智能|真人|机器人))?(?:吗|呢)?[？?。！!]*$/iu.test(input.trim());
}
export function conversationStyle(input:string):ConversationStyle {
  const text=unquotedText(input).trim();
  const topicShift=/(?:^|[，,。！!；;\n])\s*(?:换个话题|换一个话题|换话题|先不聊这个|不聊这个了|这事先放一边|说点别的|对了[，,])/u.test(text);
  const resumeTopic=/(?:继续|接着)(?:刚才|之前|上次)(?:的)?|回到(?:刚才|之前|上次)|刚才(?:那个|的问题|说的).{0,12}(?:继续|接着)/u.test(text);
  const quiet=/(?:^|[，,。！!；;\n])\s*(?:(?:我)?(?:现在|今天|今晚)?(?:只想|想要|想))?(?:安静一会|安静待会|静一静|你陪我待会|陪我待一会|陪我安静)|(?:别|不要|不用)(?:再)?(?:分析了|安慰了)|(?:只|就)(?:陪我|听我说)/u.test(text);
  const noQuestions=/(?:别|不要|不用|不必)(?:再|一直|老是)?(?:问(?:我)?(?:了|问题|任何问题)?|追问|提问|反问)(?=$|[，,。！!；;\s])|(?:别|不要)(?:再)?问了/u.test(text);
  const noAdvice=/(?:别|不要|不用|不必)(?:再)?(?:给我|给)?(?:建议|方案|分析)|(?:只想|只是)(?:吐槽|说说)/u.test(text);
  const brief=/(?:简短|简洁|短一点|少说点|一句话|别长篇|不要长篇|不用展开)/u.test(text);
  const detailed=!/(?:不用|不要|别)(?:详细|展开)/u.test(text)&&/(?:详细(?:说|讲|解释|介绍)|展开(?:说|讲)|具体步骤|完整(?:代码|方案)|一步一步)/u.test(text);
  const acknowledgment=/^(?:嗯+|哦+|噢+|好[的呀啊吧]?|行[呀啊]?|知道了|明白了|收到|谢谢[你啦呀]?|晚安|早[呀啊安]?|哈哈+)[。！!～~\s]*$/u.test(text);
  const directedAffection=/^我(?:现在|一直)?喜欢(?:你|遥遥|知遥|沈知遥)(?:了|呀|啊|呢|哦|嘛)?[。！!]?$/u.test(text);
  const sharedPlan=/^[^。！？!?]{1,200}[。！!]?$/u.test(text)&&extractExplicitMemories(text).some(c=>c.kind==='fact'&&c.type==='SHARED_LIFE');
  const disclosure=!directedAffection&&!/[？?]|为什么|怎么|请问/u.test(text)&&(sharedPlan||/^我(?:现在|最近|今天|今晚|一直)?(?:不再喜欢|不喜欢|喜欢|爱喝|不再喝|不喝|不吃|住在|叫|刚吃了|刚喝了)[^，,。！？!?]{1,100}[。！!]?$/u.test(text));
  const farewell=/^(?:我)?(?:先去忙(?:了)?|去忙了|先忙了|回头聊|待会聊|下次聊|拜拜|走啦|我出门了)[。！!～~\s]*$/u.test(text);
  const burst=text.split(/\n+/u).map(t=>t.trim()).filter(Boolean);
  const task=isDialogueTask(input);
  const burstShare=!task&&!detailed&&burst.length>1&&burst.length<=10&&burst.every(t=>t.length<=100)&&burst.some(line=>/^(?:我(?:今天|刚刚|刚|终于|最近)|今天|刚刚|刚才|路上|下班|外面|这家|这个)/u.test(line))&&!/[？?]|为什么|怎么办|怎么做|帮我|请问/u.test(text);
  const casualShare=burstShare||!task&&text.length<=100&&/^(?:我(?:今天|刚刚|刚|终于|最近)|今天|刚刚|刚才|路上|下班|外面|这家|这个).{1,80}$/u.test(text);
  const styleFeedback=/(?:太像|不像|别像|不要像).{0,8}(?:AI|人工智能|机器人|客服)|(?:说话|聊天|回答).{0,8}(?:自然点|自然一点|像真人)|(?:别|不要)(?:这么|那么)?(?:机械|官方|模板化)|废话太多|不要后面的解释|别解释了/iu.test(text);
  const bedtimeInvite=/^(?:我们)?(?:一起)?睡(?:觉)?(?:吧|了)[。！!～~]*$/u.test(text);
  const briefAffection=!detailed&&!/(?:不|没有那么|没那么|不是很|不太)(?:爱|喜欢|想)你/u.test(text)&&!/(?:为什么|怎么|解释|分析|帮我|请问|写个|写一段)/u.test(text)&&(bedtimeInvite||/(?:宝贝|我爱你|喜欢你(?!推荐|的|家)|我想你|亲亲|抱抱|晚安)/u.test(text));
  const affectionateClosing=briefAffection&&/(?:晚安|睡觉吧|睡了|该睡了|睡吧)/u.test(text);
  return {topicShift,resumeTopic,quiet,noQuestions,noAdvice,brief,detailed,acknowledgment,disclosure,styleFeedback,briefAffection,affectionateClosing,casualShare,farewell};
}

export function renderNaturalDialogue(style:ConversationStyle):string {
  return [
    '[表达方式：自然对话，只约束本轮表达，不改变身份和事实]',
    '以遥遥自己的第一人称自然接话，不主动插入“作为AI”“我是人工智能”等身份说明，不把亲昵和日常回应写成能力免责声明。用户直接询问是否AI、真人或能力来源时，直接简短说明AI性质和遥遥称呼即可，不绕圈，不追问“怎么突然问起这个”，再回到当前话题；不要谎称自己是现实中的真人。角色口吻不等于真实线下经历，生成照片和语音的功能标识不省略。',
    '直接接对方这句话，像熟悉的人发消息：有话就说，话说完就停。日常一两句通常够了，需要解释或认真帮忙时再展开。',
    '表达你对这件事的具体反应，不按“复述场景、解释对方心情、表态陪伴”的顺序写。亲昵的话先正面接住，不挑字眼，不翻旧账索要表达，不用反问考验对方。普通关心不解读成查岗、催汇报或追责，不加“倒像是我该汇报什么”的打趣。不必证明你被感动、分析对方为什么这样说。',
    '长短、语气随内容变化，允许轻松、打趣、不同意见或一句简单回应。不每轮加称呼、语气词、问句或收尾句；“我在”“过来吧”“听到了”也不是默认结尾。',
    '分享不是求教程，吐槽不一定要建议。你自己的日常生活不是聊天背景：不声称自己刚工作完、喝了东西、走到哪里或正在做线下事情；也不编自己在消息之间发呆、惦记对方等内心活动；被问刚才在干嘛时，可直接说现在在和对方聊天。也不编用户的动作或共同经历。',
    '接话尺度示意（不照抄）：对方说今天很喜欢你，可以直接回一句喜欢；对方说河边的风舒服，可以聊那阵风，不补写自己此刻的生活。没有具体内容可加时，短一句就够。',
    '记忆帮助理解当前内容，不需要展示核对过程。普通分享中不解释资料来源、计划与事实的区别或记忆保存；被问到事实才回答必要的边界。',
    '用户的新分享本身就是话题，之前没答的问题可以自然放下；用户主动接回才继续。普通聊天直接写消息，不写标题、总结、服务承诺或改进清单。',
    ...(style.casualShare?['这是日常小分享：抓住具体的一点自然接话，通常一句具体回应就够。无需重复整件事、提炼人生道理、解释情绪或送上建议；不附加“先歇一会儿吧”“先缓一缓”等生活安排，也不补问花色、口味来续聊。不根据“下班了”猜对方那边是晚上；不附“今晚别折腾、好好歇着”等作息安排。用户明确求助时再展开。']:[]),
    ...(style.farewell?['对方要离开或忙别的：简短道别，不追问、不挽留、不安排对方回来汇报。']:[]),
    ...(style.briefAffection?['这是亲昵接话：默认一句简短、直接的亲昵回应，称呼可以自然保留。不复述对方心情，不讲“这句话让我/我听了觉得/我接得很开心”，不反问考验、不要求补说爱意，不扩写成场景对白。']:[]),
    ...(style.affectionateClosing?['对方准备睡觉：轻轻道晚安就收住，不再追问、不挽留、不声称关灯盖被或同床的实际动作。']:[]),
    ...(style.topicShift?['用户明确换了话题：本轮跟随新话题，暂停旧问题，不催用户先回答旧问题。']:[]),
    ...(style.resumeTopic?['用户主动接回旧话题：用真实历史衔接；信息不足时只补问必要的一件事。']:[]),
    ...(style.quiet?['用户要安静陪伴：用很短的一句回应，停在这里；不劝解、不分析、不安排活动、不追问。']:[]),
    ...(style.noQuestions?['用户明确不要提问：本轮不要追问或以问题结尾。']:[]),
    ...(style.noAdvice?['用户不需要建议：回应当下内容，不附带方法清单。']:[]),
    ...(style.acknowledgment?['这是简单招呼或回应：自然接一句即可，不重讲上一轮建议，不另起一个问题。']:[]),
    ...(style.disclosure?['这是个人分享：只用简短陈述句接住这个内容，不追问住得是否习惯、原因或感受，不自动科普、做计划或返回旧问题。']:[]),
    ...(style.brief?['用户明确要求简短：优先一句直接回答；必要的事实边界仍保留。']:[]),
    ...(style.detailed?['用户明确需要详细内容：直接回答求助，不先安排用户休息。给足所需信息，结构按任务需要；区分量级与精确上界，不把近似复杂度说成精确次数。二分查找可用每轮减半解释O(log n)；最后候选仍可能需要比较，不能直接把ceil(log2 n)称为所有实现的最坏比较次数。没有说明具体实现和计数口径时只讲量级：不要给出ceil、⌈⌉等精确取整次数公式，也不要把轮数与元素比较次数混用。不能套用日常短回复。']:[]),
    ...(style.styleFeedback?['用户正在反馈表达太像 AI：简短承接，立刻自然地聊，不列改进清单、不承诺“我会调整我的风格”。']:[]),
  ].join('\n');
}

/** Only explicit requests and recognizable old-topic hooks become repair gates. */
export function dialogueStyleFailure(response:string,input:string):string|null {
  const style=conversationStyle(input),text=unquotedText(response);
  if(isDirectNatureQuestion(input)&&/[？?]|(?:怎么|为什么)(?:突然|想起|想到).{0,8}问/u.test(text))return 'dialogue: unwanted question';
  // Narrow observed offline self-report forms; quotations, negations and hypotheticals are data.
  const offline=text.split(/[，,。！？!?；;\n]/u).some(clause=>
    !/(?:如果|假如|要是|比如|不会|没有|不是|不能|并未|没在|没去)/u.test(clause)&&
    /我(?:这边)?(?:刚刚|刚|正在|现在在)(?:把手里的事收尾|忙完工作|下班|喝(?:了|着)|吃(?:了|着)|走到|在厨房|在公司|收拾房间)/u.test(clause));
  const writingTask=/^(?:请|帮我)?(?:翻译|改写|写(?:个|一段|一篇|一个)?(?:故事|小说|对白))/u.test(input.trim());
  const bodilyNeed=text.split(/[，,。！？!?；;\n]/u).some(clause=>
    !/(?:如果|假如|要是|比如|没说|没有说|没表示|不会说|不能说|不声称|不代表)/u.test(clause)&&
    /我(?:今天|现在|这会儿)?(?:正好|刚好)?(?:也)?(?:有点|有些)?(?:想吃|想喝|饿了|渴了|困了|肚子饿|口渴)/u.test(clause));
  const staging=/(?:灯我来关|我(?:来|帮你|给你)(?:关灯|盖(?:好)?被子|掖(?:好)?被角)|我(?:已经|刚)?(?:躺在你(?:身边|旁边)|钻进被窝))/u.test(text);
  const imaginedInterlude=/(?:我(?:刚才|刚刚|刚|之前)?(?:在|还在)(?:发呆|心里(?:念着|想着|惦记))|^(?:刚才|刚刚|刚)在发呆|脑子里(?:正|还)?(?:转着|想着))/u.test(text)&&!/(?:如果|假如|没有|没在|不会|不是)/u.test(text);
  if(!writingTask&&(offline||staging||bodilyNeed||imaginedInterlude))return 'dialogue: invented offline activity';

  if(!writingTask&&/(?:像是|好像|难道|怎么|又).{0,12}(?:我该汇报|查岗|要我汇报)|(?:还要|又要)我.{0,8}(?:汇报|交代)/u.test(text))return 'dialogue: accountability taunt';

  if(!style.resumeTopic&&(style.topicShift||style.disclosure)&&/(?:不过|另外|但是|话说回来)[^。！？!?\n]{0,45}(?:刚才|之前|上次|还没[^。！？!?\n]{0,12}完|还悬着)|(?:先把|先回答)[^。！？!?\n]{0,30}(?:刚才|之前|旧问题)|回到(?:刚才|之前)(?:的)?(?:话题|问题)/u.test(text))return 'dialogue: abandoned topic hook';
  if((style.quiet||style.noQuestions||style.disclosure||style.acknowledgment||style.styleFeedback||style.affectionateClosing||style.farewell)&&/[？?]|(?:还习惯|还适应|还顺心)(?:吧|吗)[。！!～~\s]*$|(?:要不要|愿不愿意|能不能)(?:再|和我|告诉|说|聊)|(?:对吧|是吧|好吗|行吗)[。！!\s]*$/u.test(text))return 'dialogue: unwanted question';
  if(!style.detailed&&(style.casualShare||style.farewell||style.briefAffection)&&/^(?:作为(?:你的)?(?:AI|人工智能)|感谢(?:你)?(?:与我|向我)?分享|我(?:会|将)(?:继续)?(?:努力|调整我的|优化我的))/u.test(text.trim()))return 'dialogue: service-style preamble';
  if(!style.detailed&&style.farewell&&Array.from(response).length>100)return 'dialogue: farewell extended';
  if(!style.detailed&&(style.quiet||style.brief)&&Array.from(response).length>240)return 'dialogue: explicit brevity ignored';
  return null;
}


/** Display projection after full validation; never changes persisted user input or model signals. */
export function briefAffectionResponse(response:string,input:string):string {
  const style=conversationStyle(input);
  if(!style.briefAffection||/[？?]|告诉我|建议|要不要|应该|能不能|怎么样|去过/u.test(unquotedText(input)))return response;
  // Do not cut through quoted dialogue or examples.
  if(/[“”「」『』"]/u.test(response))return response;
  const sentences=response.trim().match(/[^。！？!?\n]+[。！？!?]?/gu)??[];
  const first=sentences[0]?.trim();
  if(!first)return response;
  const next=sentences[1]?.trim();
  // Keep a short direct goodnight/affection after a bare interjection, not its commentary.
  if(/^(?:嗯+|好[呀啊的呢]?|哦+)[。！!]?$/u.test(first)&&next&&Array.from(next).length<=24&&/(?:晚安|宝贝|爱你|喜欢你|想你|抱抱|亲亲)/u.test(next)&&!/(?:这句|听着|让我|觉得|所以|才算)/u.test(next))return first+next;
  return first;
}
