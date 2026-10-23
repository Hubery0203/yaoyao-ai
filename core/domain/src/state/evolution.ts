/** Pure elapsed-time policy; no timers and no authority over identity/relationship. */
import { EMOTION_DIMENSIONS, INITIAL_EMOTION, type EmotionValues } from "./emotion.js";
export const EMOTION_EVOLUTION_POLICY = "emotion-v2-time-1";
export function evolveEmotion(values: Readonly<EmotionValues>, elapsedMs: number): EmotionValues {
  if (!Number.isFinite(elapsedMs) || elapsedMs<0) throw new Error("Invalid elapsed time");
  const next={...values};
  for (const dim of EMOTION_DIMENSIONS) {
    const halfLifeHours=dim==="hurt"?24:dim==="affection"?72:dim==="anger"?3:6;
    next[dim]=Math.round((INITIAL_EMOTION[dim]+(values[dim]-INITIAL_EMOTION[dim])*Math.pow(.5,elapsedMs/(halfLifeHours*3600000)))*1e6)/1e6;
  }
  return next;
}
