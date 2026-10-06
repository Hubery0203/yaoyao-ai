/**
 * Argon2id password hashing (Phase 4, proposal §D.1).
 *
 * OWASP interactive-login baseline: 64 MiB memory, 3 iterations,
 * parallelism 4. Hashing lives in infrastructure — never in domain,
 * application, or the HTTP layer. The HTTP layer receives this via the
 * PasswordHasher port and hashes raw passwords before calling use cases,
 * so raw passwords never cross into application/domain.
 */
import type { PasswordHasher } from "@yaoyao/application";
import argon2 from "argon2";

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    if (!plain) {
      throw new Error("password must not be empty");
    }
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Malformed stored hash: treat as non-match, never throw.
      return false;
    }
  }
}
