import { describe, it, expect } from 'vitest';
import {
  generateRandomToken,
  parseDuration,
  maskToken,
  createStoredToken,
  verifyStoredToken,
  revokeStoredToken,
  listStoredTokens,
} from '../src/token-manager';
import { Env } from '../src/types';

/**
 * In-memory Mock KVNamespace for testing
 */
class MockKVNamespace {
  private store = new Map<string, { value: string; expires?: number }>();

  async get(key: string, type?: string): Promise<any> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expires && item.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    if (type === 'json') {
      return JSON.parse(item.value);
    }
    return item.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expires = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined;
    this.store.set(key, { value, expires });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe('Token Manager', () => {
  it('generates random tokens with proper prefixes', () => {
    const perm = generateRandomToken('tg_perm');
    const eph = generateRandomToken('tg_eph');

    expect(perm.startsWith('tg_perm_')).toBe(true);
    expect(eph.startsWith('tg_eph_')).toBe(true);
    expect(perm.length).toBeGreaterThan(20);
  });

  it('correctly parses duration strings', () => {
    expect(parseDuration('1h').seconds).toBe(3600);
    expect(parseDuration('24h').seconds).toBe(86400);
    expect(parseDuration('7d').seconds).toBe(604800);
    expect(parseDuration('30m').seconds).toBe(1800);
    // minimum 60s
    expect(parseDuration('10s').seconds).toBe(60);
  });

  it('masks tokens properly', () => {
    const masked = maskToken('tg_perm_abcdef1234567890');
    expect(masked).toBe('tg_perm...7890');
  });

  it('creates and verifies permanent and ephemeral tokens in KV', async () => {
    const mockKv = new MockKVNamespace() as unknown as KVNamespace;
    const env: Env = {
      TELEGRAM_BOT_TOKEN: 'mock',
      GATEWAY_KV: mockKv,
    };

    // 1. Create permanent token
    const { token: permToken } = await createStoredToken(env, {
      type: 'permanent',
      label: 'test-backup',
      createdBy: 'alice',
    });
    expect(permToken.type).toBe('permanent');
    expect(permToken.label).toBe('test-backup');

    // Verify permanent token
    const permResult = await verifyStoredToken(permToken.token, env);
    expect(permResult.verified).toBe(true);
    expect(permResult.tokenType).toBe('permanent');

    // 2. Create ephemeral token
    const { token: ephToken, durationHuman } = await createStoredToken(env, {
      type: 'ephemeral',
      duration: '2h',
      label: 'ci-run',
      createdBy: 'bob',
    });
    expect(ephToken.type).toBe('ephemeral');
    expect(durationHuman).toBe('2 hours');

    // Verify ephemeral token
    const ephResult = await verifyStoredToken(ephToken.token, env);
    expect(ephResult.verified).toBe(true);
    expect(ephResult.tokenType).toBe('ephemeral');

    // 3. List active tokens
    const list = await listStoredTokens(env);
    expect(list.length).toBe(2);

    // 4. Revoke permanent token
    const revoked = await revokeStoredToken(permToken.token, env);
    expect(revoked).toBe(true);

    const afterRevoke = await verifyStoredToken(permToken.token, env);
    expect(afterRevoke.verified).toBe(false);

    const listAfterRevoke = await listStoredTokens(env);
    expect(listAfterRevoke.length).toBe(1);

    // 5. Short suffix (<8 chars) does not match by suffix
    const shortRevoked = await revokeStoredToken(ephToken.token.slice(-4), env);
    expect(shortRevoked).toBe(false);

    // 6. Safe unique 8-character suffix revocation succeeds
    const safeSuffix = ephToken.token.slice(-8);
    const suffixRevoked = await revokeStoredToken(safeSuffix, env);
    expect(suffixRevoked).toBe(true);

    const listFinal = await listStoredTokens(env);
    expect(listFinal.length).toBe(0);
  });
});
