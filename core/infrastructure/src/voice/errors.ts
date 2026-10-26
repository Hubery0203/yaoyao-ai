/** Provider-independent finite diagnostics. Never persist raw provider bodies or credentials. */
export const VOICE_FAILURE_CODES=['VOICE_CREDIT_EXHAUSTED','VOICE_RATE_LIMITED','VOICE_AUTH_FAILED','VOICE_RESULT_UNKNOWN','VOICE_PROVIDER_FAILED','VOICE_ARTIFACT_MISSING'] as const;
export type VoiceFailureCode=typeof VOICE_FAILURE_CODES[number];
export class VoiceProviderError extends Error{constructor(readonly code:VoiceFailureCode){super(code);}}
