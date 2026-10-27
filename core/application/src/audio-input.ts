import {voiceCommand} from './voice.js';
import {photoControl,photoRequest} from './photos.js';
import {visionControl} from './vision.js';
import {isCompanionCommandText} from './companion-commands.js';
import {isMemoryCommandText} from './experience.js';
import {isOutreachCommandText} from './outreach-commands.js';
import {isReplyCancellation,isOutreachStop} from './weixin-policy.js';
export const INCOMING_AUDIO_TEXT='[用户发来一段语音]';
export const AUDIO_UNCLEAR='这段没听清，打字告诉我吧。';
export const AUDIO_BUSY='现在语音处理有点忙，先打字聊吧。';
export const AUDIO_UNSUPPORTED='先发一段30秒以内的微信原生语音吧，也可以打字。';
export const AUDIO_DISABLED='语音输入还没开启，先打字聊吧。';
export const AUDIO_LIMIT='这次先打字聊吧，语音识别额度暂时用完了。';
export const AUDIO_CONTROL_CONFIRM='这条涉及设置或记录，请用文字发我确认。';
export function audioInputControl(text:string):'status'|'help'|'skip'|null {return text.trim()==='听语音状态'?'status':text.trim()==='听语音帮助'?'help':text.trim()==='跳过识别'?'skip':null;}
export const AUDIO_INPUT_HELP='发一段30秒以内的微信原生语音，识别后按日常聊天接话；回复沿用已选声音和原语音额度，长答仍用文字。\n优先使用微信已有转写，否则将音频交给MiniMax识别，可能产生识别、聊天及合成费用。失败或结果不明不自动重新识别；不永久保存录音。\n语音转写不自动写成长期记忆或提醒，涉及设置请用文字确认；听错了可以打字纠正。“听语音状态”查额度，“跳过识别”停止尚未发送的语音输入回复。不是实时通话。';
/** ASR has no calibrated confidence: never route it directly to command handlers. */
export function audioNeedsTypedConfirmation(text:string):boolean {
 return voiceCommand(text)!==null||photoControl(text)!==null||photoRequest(text)!==null||visionControl(text)!==null||audioInputControl(text)!==null||isCompanionCommandText(text)||isMemoryCommandText(text)||isOutreachCommandText(text)||isReplyCancellation(text)||isOutreachStop(text)||/(?:开启|关闭|暂停|取消|确认|添加|删除|修改|更新|绑定|改成|换成|关掉|打开).{0,30}(?:提醒|记忆|语音|音色|设置|主动联系|账号|名字)|(?:提醒|记忆|语音|音色|设置|主动联系|账号|名字).{0,20}(?:打开|关掉|开启|关闭|暂停|取消|改成|换成|删除)|^(?:记住|提醒我|绑定|确认联系|确认语音)|(?:帮我|给我|请|替我).{0,12}(?:提醒|记住|设置|修改|删除|开启|关闭|关掉|打开|绑定)/u.test(text);
}
