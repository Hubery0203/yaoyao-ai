import type { UserId } from "@yaoyao/domain";
export interface TemporalEmotionWriter { advance(userId:UserId,requestId:string):Promise<void>; }
export const TEMPORAL_EMOTION_WRITER="YAOYAO_TEMPORAL_EMOTION_WRITER";
