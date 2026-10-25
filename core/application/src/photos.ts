/** Photo requests are explicit, standalone operations; ordinary mention of a photo is not a paid action. */
export function photoRequest(text:string):string|null {
 const t=text.trim();if(t.length>500||/[\r\n]/u.test(t))return null;
 const command=/^(?:照片|自拍)[：:]\s*(.{1,450})$/u.exec(t);if(command)return command[1];
 if(/^(?:遥遥[，, ]*)?(?:给我|发我|发给我|给我发|给我拍|发|来|拍)(?:一张|张)(?:你的)?(?:自拍|照片|自拍照)(?:给我|给我看)?[吧呀呗～~。！!？?]*$/u.test(t))return '一张自然的日常自拍';
 const look=/^(?:我)?想看你(.{1,160})(?:的样子|的照片|的自拍)[吧呀～~。！!？?]*$/u.exec(t);return look?look[1]:null;
}
export const PHOTO_CAPTION='[AI生成图片]';
export const PHOTO_FAILURE='这张没生成好，先不自动重试了。';
