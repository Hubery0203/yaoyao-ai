/** Optional speech is a rendering of the existing final reply, never a second conversation. */
export const VOICE_NAMES=['coral','marin','shimmer'] as const;
export type VoiceName=typeof VOICE_NAMES[number];
/** Stable stored IDs; user-facing labels describe the selected MiniMax stock voice. */
export const VOICE_LABELS:Record<VoiceName,string>={coral:'温暖闺蜜',marin:'温柔学姐',shimmer:'柔和少女'};
export type VoiceCommand={kind:'help'}|{kind:'status'}|{kind:'enable'}|{kind:'disable'}|{kind:'skip'}|{kind:'voice';voice:VoiceName}|{kind:'confirm';code:string};
export function voiceCommand(text:string):VoiceCommand|null{
 const t=text.trim();const fixed:Record<string,VoiceCommand['kind']>={'语音帮助':'help','语音状态':'status','开启语音':'enable','关闭语音':'disable','跳过语音':'skip'};
 if(fixed[t])return {kind:fixed[t]} as VoiceCommand;
 const aliases:Record<string,VoiceName>={'温暖闺蜜':'coral','温柔学姐':'marin','柔和少女':'shimmer',coral:'coral',marin:'marin',shimmer:'shimmer'};
 const voice=/^语音声音 (\S+)$/.exec(t);if(voice&&Object.hasOwn(aliases,voice[1]))return {kind:'voice',voice:aliases[voice[1]]};
 const confirm=/^确认语音 ([A-F0-9]{8})$/.exec(t);return confirm?{kind:'confirm',code:confirm[1]}:null;
}
export const VOICE_HELP='发送“开启语音”，确认后仅对新收到的日常文字聊天生成AI语音，当前以MP3文件发送，不是微信原生语音条。回复文字会发给MiniMax合成；长回复、控制指令和主动联系仍用文字。\n“关闭语音”立即停止后续合成；“语音状态”查额度；“跳过语音”跳过未完成音频；“语音声音 温暖闺蜜/温柔学姐/柔和少女”选择内置声音。不支持语音输入或实时通话。';
export function voiceTextEligible(text:string,max=240):boolean{return text.trim().length>0&&text.length<=max&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)&&!/(?:https?:\/\/|```|<#[^>]*#>|\((?:laughs|chuckle|coughs|clear-throat|groans|breath|pant|inhale|exhale|gasps|sniffs|sighs|snorts|burps|lip-smacking|humming|hissing|emm|sneezes)\))/i.test(text);}
