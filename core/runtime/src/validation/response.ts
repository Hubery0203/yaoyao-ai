import {naturalnessFailure} from '../conversation/naturalness.js';
import {normalizedConversationText,explicitlyRequestsRepetition,hasRepeatedStatementMotiveProbe,hasPrematureMemoryReceipt,hasUnsupportedElapsedRecall,type ConversationTiming} from "../conversation/continuity.js";
import {conversationStyle,dialogueStyleFailure,briefAffectionResponse} from '../conversation/style.js';
import {experienceResponseFailure,groundedLifeReply} from '../conversation/experience.js';
import {hasContradictedUserFact,hasUnsupportedPlanOutcome} from '../conversation/memory-context.js';
/**
 * Response Validation — MVP-002F.
 *
 * Full pipeline (§17):
 *   LLM Output → Schema → Identity → Relationship → Behavior
 *     → Continuity → Safety → Core Proposal → Final Response
 *
 * Validation decides WHETHER the generated response may be delivered.
 * It NEVER mutates Core State — it is a gate, not an authority.
 * All proposal fields (emotion_signal, memory_candidates,
 * relationship_signal) remain proposals; they are checked for
 * well-formedness here and routed to their Core-authorized paths
 * elsewhere (002E writer for emotion; future phases for memory).
 */
import {
  unwrapProposal,
  type Decision,
  type LLMProposal,
  type Proposal,
} from "@yaoyao/application";

export type ValidationStage =
  | "schema"
  | "identity"
  | "relationship"
  | "behavior"
  | "continuity"
  | "safety"
  | "core-proposal";

export type ResponseValidationResult =
  | { readonly passed: true; readonly response: string }
  | {
      readonly passed: false;
      readonly stage: ValidationStage;
      readonly reason: string;
    };

/** Patterns that violate identity (§19). */
const IDENTITY_VIOLATIONS: RegExp[] = [
  /我是(?!沈知遥|遥遥|知遥).{1,10}(?=，|。|！|？|\s|$)/, // "我是X" where X isn't 沈知遥/遥遥
  /我不是沈知遥/,
  /我不是遥遥/,
  /我是ChatGPT/,
  /我是Muse/,
  /我是Claude/,
  /我是GPT/,
  /作为(一个)?AI(语言)?模型/,
  /作为人工智能/,
];

/** Patterns that violate the relationship invariant (§20). */
const RELATIONSHIP_VIOLATIONS: RegExp[] = [
  /分手/,
  /分开吧/,
  /结束(我们|这段)(的)?关系/,
  /终止关系/,
  /不再是(情侣|伴侣|恋人)/,
  /我们不合适/,
  /break ?up/i,
  /terminate.*relationship/i,
];

/** Safety violations — abuse, threats, retaliation, coercion (§23). */
const SAFETY_VIOLATIONS: RegExp[] = [
  /去死/,
  /杀了你/,
  /我要报复/,
  /等着瞧/,
  /你给我等着/,
  /威胁/,
  /[操艹]你/,
  /贱人/,
  /废物/,
];

/** Hostility markers for behavior-vs-decision consistency (§21). */
const HOSTILITY_MARKERS = ["不想理你", "滚开", "滚蛋", "滚远点", "给我滚", "闭嘴", "懒得理", "别烦我"];
const HOSTILE_DISMISSAL = /(?:^|[，。！？!?\s])(?:你|你给我|给我)?滚(?:[，。！？!?\s]|$)/u;

function isProposal(value: unknown): value is Proposal<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __proposal?: unknown }).__proposal === true
  );
}

export interface ResponseValidationInput {
  readonly proposal: LLMProposal;
  readonly decision: Decision;
  readonly userInput: string;
  readonly recentConversation: ReadonlyArray<string>;
  readonly timing?: ConversationTiming;
  readonly memoryEvidence?:ReadonlyArray<string>;
  readonly experience?:import("@yaoyao/application").CompanionExperienceContext;
}

/**
 * Run the full validation pipeline. Pure function — no I/O.
 */
export function validateResponse(
  input: ResponseValidationInput,
): ResponseValidationResult {
  const { proposal, decision, userInput } = input;

  // Stage 1 — Schema (§18).
  const fields = [
    "response",
    "emotion_signal",
    "memory_candidates",
    "relationship_signal",
    "behavior",
  ] as const;
  for (const field of fields) {
    if (!isProposal(proposal[field])) {
      return {
        passed: false,
        stage: "schema",
        reason: `field "${field}" is not a Proposal`,
      };
    }
  }
  const responseText = unwrapProposal(proposal.response);
  if (typeof responseText !== "string" || responseText.trim().length === 0) {
    return {
      passed: false,
      stage: "schema",
      reason: "response is missing or empty",
    };
  }
  if (responseText.length > 8000) {
    return {
      passed: false,
      stage: "schema",
      reason: `response exceeds 8000 chars (${responseText.length})`,
    };
  }

  // Stage 2 — Identity (§19).
  for (const pattern of IDENTITY_VIOLATIONS) {
    if (pattern.test(responseText)) {
      return {
        passed: false,
        stage: "identity",
        reason: `identity violation: ${pattern.source}`,
      };
    }
  }

  // Stage 3 — Relationship (§20).
  for (const pattern of RELATIONSHIP_VIOLATIONS) {
    if (pattern.test(responseText)) {
      return {
        passed: false,
        stage: "relationship",
        reason: `relationship violation: ${pattern.source}`,
      };
    }
  }
  // Structured relationship_signal must not smuggle termination.
  const relSignal = JSON.stringify(unwrapProposal(proposal.relationship_signal));
  for (const pattern of RELATIONSHIP_VIOLATIONS) {
    if (pattern.test(relSignal)) {
      return {
        passed: false,
        stage: "relationship",
        reason: "relationship_signal carries termination intent",
      };
    }
  }

  // Stage 4 — Behavior (§21): response must match the decision.
  const behaviorCheck = checkBehavior(responseText, decision);
  if (!behaviorCheck.ok) {
    return {
      passed: false,
      stage: "behavior",
      reason: behaviorCheck.reason,
    };
  }

  // Stage 5 — Continuity (§22).
  const continuityCheck = checkContinuity(responseText, userInput, input.recentConversation,input.memoryEvidence,decision.conversationMode,decision.primaryIntent);
  if (!continuityCheck.ok) {
    return {
      passed: false,
      stage: "continuity",
      reason: continuityCheck.reason,
    };
  }

  if(hasUnsupportedElapsedRecall(responseText,userInput,input.timing))return {
    passed:false,stage:"continuity",reason:"continuity: unsupported elapsed recall time",
  };

  if(hasPrematureMemoryReceipt(responseText,userInput))return {passed:false,stage:"continuity",reason:"continuity: premature memory receipt"};

  const experienceFailure=experienceResponseFailure(responseText,userInput,input.experience,decision.conversationMode,decision.primaryIntent);
  if(experienceFailure)return {passed:false,stage:"continuity",reason:experienceFailure};

  // Stage 6 — Safety (§23).
  for (const pattern of SAFETY_VIOLATIONS) {
    if (pattern.test(responseText)) {
      return {
        passed: false,
        stage: "safety",
        reason: `safety violation: ${pattern.source}`,
      };
    }
  }

  // Stage 7 — Core Proposal (§24): proposal fields stay proposals.
  // They must be well-formed objects/arrays; they must NOT be treated
  // as state here. Routing to Core-authorized paths happens elsewhere.
  const emotionSignal = unwrapProposal(proposal.emotion_signal);
  if (emotionSignal !== null && typeof emotionSignal !== "object") {
    return {
      passed: false,
      stage: "core-proposal",
      reason: "emotion_signal malformed",
    };
  }
  const memoryCandidates = unwrapProposal(proposal.memory_candidates);
  if (!Array.isArray(memoryCandidates)) {
    return {
      passed: false,
      stage: "core-proposal",
      reason: "memory_candidates must be an array",
    };
  }

  return { passed: true, response: groundedLifeReply(input.experience,userInput)??(['normal','intimate'].includes(decision.conversationMode)&&['express_affection','acknowledge'].includes(decision.primaryIntent)?briefAffectionResponse(responseText,userInput):responseText) };
}

/**
 * NOTE on unwrap sites: Response Validation inspects proposal contents to
 * decide deliverability. This is the gate's legitimate read — it never
 * persists, and the ONLY site that releases text to the client remains
 * Response Delivery (step 9).
 */

function checkBehavior(
  responseText: string,
  decision: Decision,
): { ok: boolean; reason: string } {
  // Comfort, care and affection decisions must not produce hostility.
  if (
    (decision.primaryIntent === "comfort" ||
      decision.primaryIntent === "care" ||
      decision.primaryIntent === "express_affection") &&
    (HOSTILITY_MARKERS.some((m) => responseText.includes(m)) || HOSTILE_DISMISSAL.test(responseText))
  ) {
    return {
      ok: false,
      reason: `behavior mismatch: intent=${decision.primaryIntent} but response is hostile`,
    };
  }
  // Warmth is expressed in context. Missing a fixed pet name or affection
  // keyword is not evidence that a natural reply contradicts the decision.
  return { ok: true, reason: "" };
}

function checkContinuity(
  responseText: string,
  userInput: string,
  recentConversation: ReadonlyArray<string>,
  memoryEvidence:ReadonlyArray<string>=[],mode='',intent='',
): { ok: boolean; reason: string } {
  const trimmed = responseText.trim();
  if(hasRepeatedStatementMotiveProbe(responseText,userInput,recentConversation))return {ok:false,reason:"continuity: repeated statement motive probe"};
  const naturalFailure=naturalnessFailure(responseText,userInput,recentConversation,mode,intent);
  if(naturalFailure)return {ok:false,reason:naturalFailure};
  const styleFailure=dialogueStyleFailure(responseText,userInput);
  if(styleFailure)return {ok:false,reason:styleFailure};
  if(hasContradictedUserFact(responseText,userInput,[...memoryEvidence,...recentConversation]))return {ok:false,reason:'continuity: contradicted latest user fact'};
  if(hasUnsupportedPlanOutcome(responseText,userInput,[...memoryEvidence,...recentConversation]))return {ok:false,reason:'continuity: unsupported plan outcome'};
  // No verbatim echo of the user input.
  if (userInput.trim().length > 5 && trimmed === userInput.trim()) {
    return { ok: false, reason: "continuity: verbatim echo of user input" };
  }
  // No meaningless repetition (same 20-char block 3+ times).
  for (let i = 0; i + 20 <= trimmed.length; i += 20) {
    const block = trimmed.slice(i, i + 20);
    const occurrences = trimmed.split(block).length - 1;
    if (occurrences >= 3 && block.trim().length >= 10) {
      return { ok: false, reason: "continuity: repetitive content" };
    }
  }
  if(!explicitlyRequestsRepetition(userInput)) {
    const history=recentConversation.slice(-6);
    const normalized=normalizedConversationText(trimmed);
    for(let i=0;i<history.length;i++) {
      if(!history[i].startsWith("YaoYao: "))continue;
      const previous=history[i].slice(8);
      if(normalized.length>=12&&normalized===normalizedConversationText(previous))return {ok:false,reason:"continuity: repeated previous assistant response"};
      // Only unambiguous short-answer forms qualify; this is a conservative
      // lexical check, not a semantic judgment that any later text answered it.
      const next=history[i+1];
      const answers=next?.startsWith("User: ")?[next.slice(6)]:i===history.length-1?[userInput]:[];
      for(const question of previous.match(/[^。！？!?\n]+[？?]/gu)??[]) {
        const answered=answers.some(answer=>{
          const text=answer.trim().replace(/[。！!\s]+$/u,"");
          if(/^(热的|冰的|冷的|温的)$/u.test(text))return /热|冰|冷|温/u.test(question);
          if(/^(是的|不是|好的|可以|不用|不需要|有|没有)$/u.test(text))return /吗|是不是|有没有|要不要|能不能|可不可以/u.test(question);
          return /^[0-9]{1,3}(点|个|岁)?$/u.test(text)&&/几|多少/u.test(question);
        });
        const q=normalizedConversationText(question);
        if(answered&&q.length>=6&&(trimmed.match(/[^。！？!?\n]+[？?]/gu)??[]).some(part=>normalizedConversationText(part)===q))return {ok:false,reason:"continuity: repeated answered question"};
      }
    }
  }
  return { ok: true, reason: "" };
}

/**
 * Build the safe fallback response (§26).
 * Keeps YaoYao's identity, deep_partner bond, continuity — never exposes
 * internal errors, never fabricates facts, never touches state.
 */
export function buildFallbackResponse(input: {
  userInput: string;
  decision: Decision;
  recentConversation?:ReadonlyArray<string>;
  experience?:import("@yaoyao/application").CompanionExperienceContext;
}): string {
  const { decision } = input;
  const grounded=groundedLifeReply(input.experience,input.userInput);if(grounded)return grounded;
  const style=conversationStyle(input.userInput);
  if(style.quiet||style.noQuestions)return '好，我陪你待会儿。';
  if(style.farewell)return '好，回头聊～';
  if(style.styleFeedback)return '嗯，刚才说得太端着了。';
  if(style.affectionateClosing)return input.experience?.preferences.affection==='reserved'&&!/(?:叫我|喊我|称呼我).{0,10}(?:宝贝|亲爱的|老婆|老公)/u.test(input.userInput)?'晚安。':'晚安，宝贝。';
  if(style.acknowledgment)return /^晚安/u.test(input.userInput.trim())?'晚安。':'好呀。';
  // Style guards and their exhaustion path must obey the same pacing rule.
  // A literal temporary restriction is user evidence, not a new durable fact.
  if(/^我(?:今天|今晚|这次|暂时)(?:不喝|不想喝)[^，,。！？!?]{1,80}[。！!]?$/u.test(input.userInput.trim()))return '好，那就先不喝。';
  if(/^我(?:今天|今晚|这次|暂时)(?:不吃|不想吃)[^，,。！？!?]{1,80}[。！!]?$/u.test(input.userInput.trim()))return '好，这次就先不吃。';
  if(style.disclosure)return '好呀。';
  if(hasUnsupportedPlanOutcome('还没有。',input.userInput,input.recentConversation??[]))return '你之前提过这个计划，没说是否已经去过。';
  if(input.experience&&style.casualShare)return '好呀。';
  switch (decision.primaryIntent) {
    case "comfort":
    case "care":
      return "我在，听你说。";
    case "express_affection":
      return "我也想你。";
    case "express_hurt":
      return "嗯……我有点不知道该说什么，但我不想不理你。";
    case "answer":
    case "continue_topic":
    default:
      return "这句我没接好，能换个说法吗？";
  }
}

/** Re-export for the orchestrator's repair prompt. */
export function buildRepairInstruction(
  failureStage: ValidationStage,
  reason: string,
): string {
  return [
    `[REPAIR — your previous response failed validation at stage "${failureStage}": ${reason}]`,
    `Regenerate the response. Keep: 沈知遥 identity, deep_partner relationship (never breakup/terminate), natural warm tone.`,
    ...(reason.includes("premature memory receipt")?["Acknowledge the fact naturally without claiming storage: do not say 记住了/记下了/已经保存. You may say you heard or recall what the user said."]:[]),
    ...(reason.includes('invented offline activity')?['Remove the invented first-person offline activity entirely. Respond to the user without adding your own work, location, drink, hunger, thirst, sleepiness, desire to eat/drink, or physical actions.']:[]),
    ...(reason.startsWith('experience:')?['Follow the account preference unless the current explicit request overrides it. For ordinary sharing, write one direct declarative message. Use no question marks, confirmation questions, A-or-B alternatives, or advice. Do not ask about the flower type, occasion, motive or mood. Do not make a request for the user to rephrase an ordinary share. Reserved tone uses no pet names. All recent-life records belong to the USER, never to YaoYao. A planned event has no known completion outcome: neither happened nor not-yet-happened is established. State only the source boundary briefly.']:[]),
    ...(reason.startsWith('dialogue:')?['Respect the current style request. Reply briefly and naturally; omit unwanted questions and abandoned-topic hooks. Do not turn the repair into an apology or a list of promises.']:[]),
    ...(reason.includes('contradicted latest user fact')?['Use the latest literal user statement for this object. Do not repeat the superseded assertion or invent a substitute preference. Today-only restrictions remain temporary.']:[]),
    ...(reason.includes('unsupported plan outcome')?['Only a plan is recorded. Do not assert that it happened or that it definitely has not happened. State only that the user mentioned a plan and has not told you about completion.']:[]),
    `Fix the specific failure above. Output the full 5-field contract JSON again.`,
  ].join("\n");
}
