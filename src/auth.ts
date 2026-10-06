import { Context } from 'hono';
import { Env, AuthVerificationResult } from './types';
import { verifyStoredToken } from './token-manager';

/**
 * Extracts raw token string from request:
 * 1. `x-api-key` header
 * 2. `Authorization: Bearer <token>` header
 * 3. `?token=<token>` query parameter
 */
export function extractToken(c: Context<{ Bindings: Env }>): string | null {
  // 1. Check x-api-key header
  const apiKeyHeader = c.req.header('x-api-key');
  if (apiKeyHeader && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }

  // 2. Check Authorization: Bearer <token>
  const authHeader = c.req.header('authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }

  // 3. Check query param ?token=
  const queryToken = c.req.query('token');
  if (queryToken && queryToken.trim()) {
    return queryToken.trim();
  }

  return null;
}

/**
 * Extracts and validates authentication from incoming request across all 3 token sources:
 * 1. Master static env.AUTH_TOKEN
 * 2. Permanent bot-generated tokens in KV
 * 3. Ephemeral bot-generated tokens in KV (with TTL expiry)
 */
export async function verifyAuth(
  c: Context<{ Bindings: Env }>
): Promise<AuthVerificationResult> {
  const token = extractToken(c);

  if (!token) {
    return { verified: false };
  }

  // 1. Check master static env.AUTH_TOKEN (timing-safe comparison)
  const expectedMaster = c.env.AUTH_TOKEN;
  if (expectedMaster && expectedMaster.trim() !== '') {
    if (timingSafeEqual(token, expectedMaster.trim())) {
      return {
        verified: true,
        tokenType: 'env',
        tokenLabel: 'master-env',
      };
    }
  }

  // 2. Check dynamic bot tokens in KV (both permanent and ephemeral)
  const storedResult = await verifyStoredToken(token, c.env);
  if (storedResult.verified) {
    return storedResult;
  }

  return { verified: false };
}

/**
 * Timing-safe string comparison to protect against timing attacks
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
