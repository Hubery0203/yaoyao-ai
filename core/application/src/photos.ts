/** Photo requests are explicit, standalone operations; ordinary mention of a photo is not a paid action. */
export function photoRequest(text:string):string|null {
 const t=text.trim();if(t.length>500||/[\r\n]/u.test(t))return null;
 const command=/^(?:照片|自拍)[：:]\s*(.{1,450})$/u.exec(t);if(command)return command[1];
 if(/^(?:遥遥[，, ]*)?(?:给我|发我|发给我|给我发|给我拍|发|来|拍)(?:一张|张)(?:你的)?(?:自拍|照片|自拍照)(?:给我|给我看)?[吧呀呗～~。！!？?]*$/u.test(t))return '一张自然的日常自拍';
 const look=/^(?:我)?想看你(.{1,160})(?:的样子|的照片|的自拍)[吧呀～~。！!？?]*$/u.exec(t);return look?look[1]:null;
}
export const PHOTO_CAPTION='[AI生成图片]';
export const PHOTO_FAILURE='这张没生成好，先不自动重试了。';
export const PHOTO_FAILURE_CODES=['PHOTO_CREDIT_EXHAUSTED','PHOTO_RATE_LIMITED','PHOTO_AUTH_FAILED','PHOTO_REJECTED','PHOTO_RESULT_UNKNOWN','PHOTO_PROVIDER_FAILED'] as const;
export type PhotoFailureCode=typeof PHOTO_FAILURE_CODES[number];
export function photoFailureMessage(code:PhotoFailureCode):string{
 const messages:Record<PhotoFailureCode,string>={PHOTO_CREDIT_EXHAUSTED:'图片服务余额不足，补充后再发新请求；这条不会自动重试。',PHOTO_RATE_LIMITED:'图片服务暂时限流，这条不会自动重试，稍后再发新请求。',PHOTO_AUTH_FAILED:'图片服务授权不可用，需先检查配置；这条不会自动重试。',PHOTO_REJECTED:'这张没能生成，请换个日常场景；这条不会自动重试。',PHOTO_RESULT_UNKNOWN:PHOTO_FAILURE,PHOTO_PROVIDER_FAILED:PHOTO_FAILURE};return messages[code];
}
export function photoControl(text:string):'status'|'help'|null{return text.trim()==='照片状态'?'status':text.trim()==='照片帮助'?'help':null;}
export const PHOTO_HELP='发送“发张自拍给我”或“照片：穿毛衣在窗边微笑”。\n使用你的参考形象生成AI图片，不是现实拍摄。\n“照片状态”查看尝试额度和最近任务；“跳过照片”跳过未完成任务。\n失败或结果不明也占尝试额度，不自动重新生成；接口接受不等于手机已收到。';
