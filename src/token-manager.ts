import { Env, StoredToken, AuthVerificationResult } from './types';

/**
 * Generates a cryptographically secure random token string with a specific prefix
 */
export function generateRandomToken(prefix: 'tg_perm' | 'tg_eph'): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const randomHex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}_${randomHex}`;
}

/**
 * Parses duration strings like "30m", "1h", "24h", "7d", "30d" into seconds
 * Minimum 60 seconds (Cloudflare KV minimum TTL)
 */
export function parseDuration(durationStr?: string): { seconds: number; human: string } {
  if (!durationStr || durationStr.trim() === '') {
    return { seconds: 86400, human: '24 hours' }; // default 24h
  }

  const clean = durationStr.trim().toLowerCase();
  const match = clean.match(/^(\d+)\s*(s|sec|seconds|m|min|h|hr|d|day|days)?$/);

  if (!match) {
    return { seconds: 86400, human: '24 hours' };
  }

  const val = parseInt(match[1], 10);
  const unit = match[2] || 'h';

  let seconds = 86400;
  let human = `${val} hours`;

  switch (unit) {
    case 's':
    case 'sec':
    case 'seconds':
      seconds = Math.max(60, val);
      human = `${seconds} seconds`;
      break;
    case 'm':
    case 'min':
      seconds = Math.max(60, val * 60);
      human = `${val} minute${val > 1 ? 's' : ''}`;
      break;
    case 'h':
    case 'hr':
      seconds = val * 3600;
      human = `${val} hour${val > 1 ? 's' : ''}`;
      break;
    case 'd':
    case 'day':
    case 'days':
      seconds = val * 86400;
      human = `${val} day${val > 1 ? 's' : ''}`;
      break;
  }

  // Cloudflare KV requires expirationTtl to be at least 60 seconds
  if (seconds < 60) {
    seconds = 60;
    human = '1 minute (minimum)';
  }

  return { seconds, human };
}

/**
 * Creates and stores a new permanent or ephemeral token in Cloudflare KV
 */
export async function createStoredToken(
  env: Env,
  options: {
    type: 'permanent' | 'ephemeral';
    label?: string;
    duration?: string;
    createdBy: string;
  }
): Promise<{ token: StoredToken; durationHuman?: string }> {
  if (!env.GATEWAY_KV) {
    throw new Error(
      'Cloudflare KV (GATEWAY_KV) is not bound. Bind GATEWAY_KV in wrangler.toml to use dynamic bot tokens.'
    );
  }

  const now = Date.now();
  const isEphemeral = options.type === 'ephemeral';
  const prefix = isEphemeral ? 'tg_eph' : 'tg_perm';
  const tokenString = generateRandomToken(prefix);

  const cleanLabel = (options.label || options.type).replace(/[^\w\s-]/g, '').trim() || options.type;

  let expiresAt: number | undefined;
  let durationHuman: string | undefined;
  let kvPutOptions: KVNamespacePutOptions | undefined;

  if (isEphemeral) {
    const { seconds, human } = parseDuration(options.duration);
    durationHuman = human;
    expiresAt = now + seconds * 1000;
    kvPutOptions = { expirationTtl: seconds };
  }

  const storedToken: StoredToken = {
    token: tokenString,
    type: options.type,
    label: cleanLabel,
    createdAt: now,
    expiresAt,
    createdBy: options.createdBy,
  };

  // 1. Save token key in KV
  await env.GATEWAY_KV.put(
    `token:${tokenString}`,
    JSON.stringify(storedToken),
    kvPutOptions
  );

  // 2. Update token index list in KV
  try {
    const existingIndex = await listStoredTokens(env);
    const updatedIndex = [
      ...existingIndex.filter((t) => t.token !== tokenString),
      storedToken,
    ];
    await env.GATEWAY_KV.put('tokens:index', JSON.stringify(updatedIndex));
  } catch (err) {
    console.warn('[TokenManager] Failed to update token index in KV:', err);
  }

  return { token: storedToken, durationHuman };
}

/**
 * Verifies a token against Cloudflare KV
 */
export async function verifyStoredToken(
  token: string,
  env: Env
): Promise<AuthVerificationResult> {
  if (!env.GATEWAY_KV) {
    return { verified: false };
  }

  try {
    const data = await env.GATEWAY_KV.get(`token:${token}`, 'json');
    if (!data) {
      return { verified: false };
    }

    const stored = data as StoredToken;

    // Check expiration for ephemeral tokens
    if (stored.type === 'ephemeral' && stored.expiresAt && stored.expiresAt < Date.now()) {
      return { verified: false };
    }

    return {
      verified: true,
      tokenType: stored.type,
      tokenLabel: stored.label,
    };
  } catch (err) {
    console.error('[TokenManager] Error reading token from KV:', err);
    return { verified: false };
  }
}

/**
 * Revokes a stored token by deleting it from KV and removing from index
 */
export async function revokeStoredToken(token: string, env: Env): Promise<boolean> {
  if (!env.GATEWAY_KV) return false;

  const cleanToken = token.trim();
  if (!cleanToken) return false;

  try {
    const list = await listStoredTokens(env);
    const exactMatch = list.find((t) => t.token === cleanToken);
    let matches: StoredToken[] = [];

    if (exactMatch) {
      matches = [exactMatch];
    } else if (cleanToken.length >= 8) {
      matches = list.filter((t) => t.token.endsWith(cleanToken));
      if (matches.length > 1) {
        throw new Error(`Ambiguous token suffix "${cleanToken}" matches ${matches.length} active tokens.`);
      }
    }

    if (matches.length > 0) {
      // Delete the actual full token keys from KV for all matches
      for (const m of matches) {
        await env.GATEWAY_KV.delete(`token:${m.token}`);
      }
      // Update index
      const remaining = list.filter(
        (t) => !matches.some((m) => m.token === t.token)
      );
      await env.GATEWAY_KV.put('tokens:index', JSON.stringify(remaining));
      return true;
    }

    // Fallback: in case token is an orphaned key not in the index, try deleting directly
    const directKey = `token:${cleanToken}`;
    const directData = await env.GATEWAY_KV.get(directKey);
    if (directData) {
      await env.GATEWAY_KV.delete(directKey);
      return true;
    }

    return false;
  } catch (err) {
    console.error('[TokenManager] Failed to revoke token:', err);
    return false;
  }
}

/**
 * Lists all active stored tokens (pruning expired ones)
 */
export async function listStoredTokens(env: Env): Promise<StoredToken[]> {
  if (!env.GATEWAY_KV) return [];

  try {
    const data = await env.GATEWAY_KV.get('tokens:index', 'json');
    if (!data || !Array.isArray(data)) {
      return [];
    }

    const now = Date.now();
    // Filter out expired ephemeral tokens
    const valid = (data as StoredToken[]).filter((t) => {
      if (t.type === 'ephemeral' && t.expiresAt && t.expiresAt < now) {
        return false;
      }
      return true;
    });

    return valid;
  } catch (err) {
    console.error('[TokenManager] Failed to list tokens from KV:', err);
    return [];
  }
}

/**
 * Masks a token for display in chat: e.g. "tg_perm_...a1b2"
 */
export function maskToken(token: string): string {
  if (token.length <= 12) return token;
  const prefix = token.slice(0, 7); // e.g. "tg_perm" or "tg_eph_"
  const suffix = token.slice(-4);
  return `${prefix}...${suffix}`;
}
