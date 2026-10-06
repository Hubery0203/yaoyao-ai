import pino, { type Logger } from "pino";
import type { AppConfig } from "../config/env.js";

/**
 * Structured JSON logging (Technical Proposal §14).
 *
 * Correlation: every log line carries service/version; request handlers add
 * request_id and event-producing paths add event_id via child loggers.
 *
 * Redaction: secrets and private content are censored by default — passwords,
 * tokens, raw event payloads, memory content, and private state bodies must
 * NEVER appear in logs (see T007-adjacent log-redaction gate, Phase 8).
 */
const REDACT_PATHS = [
  "password",
  "password_hash",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "*.password",
  "*.password_hash",
  "*.token",
  "payload.content",
  "memory.content",
];

export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: "yaoyao-ai", env: config.NODE_ENV },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}
