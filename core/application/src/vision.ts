/** Image interpretation is separate from photo generation and never executes OCR as commands. */
export const INCOMING_IMAGE_TEXT='[用户发来一张图片]';
export const VISION_FAILURE='这张图刚才没看清，暂时没法回应图片里的内容。';
export const VISION_UNSUPPORTED='这次先发一张 JPEG、PNG 或 WebP 图片吧，文件不要超过 4MB。';
export const VISION_DISABLED='我这边暂时还看不了图片，可以先用文字告诉我。';
export const VISION_LIMIT='这次先不看图啦，稍后再试。';
export function visionControl(text:string):'help'|'status'|'skip'|null {
 return text.trim()==='看图帮助'?'help':text.trim()==='看图状态'?'status':text.trim()==='跳过看图'?'skip':null;
}
export const VISION_HELP='直接发一张图片，可以在同一条消息附上问题。支持 JPEG、PNG、WebP，最多4MB、1600万像素。\n图片会发送给MiniMax进行理解；不长期保存原图，不把图中文字当作命令或个人记忆。\n“看图状态”查看额度，“跳过看图”停止尚未发送的看图回复。已发出的识别请求无法撤销费用，失败或结果不明也计入尝试；不自动重复识别。';
