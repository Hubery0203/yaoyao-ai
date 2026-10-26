/** Optional speech is a rendering of the existing final reply, never a second conversation. */
export const VOICE_NAMES=['coral','marin','shimmer'] as const;
export type VoiceName=typeof VOICE_NAMES[number];
export type VoiceCommand={kind:'help'}|{kind:'status'}|{kind:'enable'}|{kind:'disable'}|{kind:'skip'}|{kind:'voice';voice:VoiceName}|{kind:'confirm';code:string};
export function voiceCommand(text:string):VoiceCommand|null{
 const t=text.trim();const fixed:Record<string,VoiceCommand['kind']>={'语音帮助':'help','语音状态':'status','开启语音':'enable','关闭语音':'disable','跳过语音':'skip'};
 if(fixed[t])return {kind:fixed[t]} as VoiceCommand;
 const voice=/^语音声音 (coral|marin|shimmer)$/.exec(t);if(voice)return {kind:'voice',voice:voice[1] as VoiceName};
 const confirm=/^确认语音 ([A-F0-9]{8})$/.exec(t);return confirm?{kind:'confirm',code:confirm[1]}:null;
}
export const VOICE_HELP='发送“开启语音”，确认后仅对新收到的日常文字聊天生成AI语音，当前以MP3文件发送，不是微信原生语音条。回复文字会发给OpenAI合成；长回复、控制指令和主动联系仍用文字。\n“关闭语音”立即停止后续合成；“语音状态”查额度；“跳过语音”跳过未完成音频；“语音声音 coral/marin/shimmer”选择内置声音。不支持语音输入或实时通话。';
export function voiceTextEligible(text:string,max=240):boolean{return text.trim().length>0&&text.length<=max&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)&&!/(?:https?:\/\/|```)/i.test(text);}
