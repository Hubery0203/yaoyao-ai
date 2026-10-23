/** Bounded deterministic hints; no model call, persistence or state authority. */
export function classifySituation(input: string): {intent:string;urgency:string;taskNature:string} {
  const text=input.trim().slice(0,4000);
  const urgent=/(救命|出事了|撑不住了|急需帮助)/u.test(text);
  const question=/[?？]|为什么|怎么|如何|什么|哪里|哪个|多少|几点|是不是|有没有|能不能|可不可以|吗[呀啊呢吧。！!\s]*$/u.test(text);
  const preference=/^我(?:最近|现在|一直)?(?:更|很|特别|比较)?(?:喜欢|不喜欢|爱喝)/u.test(text);
  return {intent:question?'question':preference?'preference':'chat',urgency:urgent?'high':'normal',taskNature:urgent?'emotional-support':question?'question':preference?'preference':'general'};
}
