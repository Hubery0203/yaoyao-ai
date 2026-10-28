/** Explicit owner-approved subjects only; never infer an event's outcome. */
export const CARE_WINDOW_MS=30*60000;
export function normalizeCareTopic(value:string):string|null{
 if(typeof value!=='string'||/[\u0000-\u001f\u007f]/u.test(value))return null;
 const topic=value.normalize('NFKC').replace(/\s+/gu,' ').trim();
 return topic.length>0&&topic.length<=40?topic:null;
}
export function careMessage(topic:string):string{
 const clean=normalizeCareTopic(topic);if(!clean||clean!==topic)throw Error('INVALID_CARE_TOPIC');
 return '想听你说说「'+clean+'」这件事。';
}
