/**
 * Idempotency hashing (Technical Proposal v0.2 §I).
 *
 * Raw Idempotency-Key values and raw request bodies are never stored;
 * only their SHA-256 digests persist. Canonicalization is deliberately
 * simple and documented: UTF-8 bytes of the exact string the caller
 * passed. Callers that need body normalization do it before calling.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 digest of UTF-8 input, as a Buffer (bytea storage). */
export function sha256Bytes(input: string | Buffer): Buffer {
  return createHash("sha256").update(input).digest();
}

/** key_hash = SHA-256(Idempotency-Key header value). */
export function idempotencyKeyHash(key: string): Buffer {
  if (!key) throw new Error("idempotency key must not be empty");
  return sha256Bytes(key);
}

/** request_hash = SHA-256(canonical request body). */
export function requestBodyHash(canonicalBody: string): Buffer {
  return sha256Bytes(canonicalBody);
}

/** Constant-time digest comparison for the request-match check. */
export function digestsEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
