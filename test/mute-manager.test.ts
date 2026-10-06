import { describe, it, expect, beforeEach } from 'vitest';
import {
  isTopicMuted,
  muteTopic,
  unmuteTopic,
  listMutedTopics,
} from '../src/mute-manager';
import { Env } from '../src/types';

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

describe('Topic Mute Manager', () => {
  let mockKv: KVNamespace;
  let mockEnv: Env;

  beforeEach(() => {
    mockKv = new MockKVNamespace() as unknown as KVNamespace;
    mockEnv = {
      TELEGRAM_BOT_TOKEN: 'mock_bot_token',
      GATEWAY_KV: mockKv,
    };
  });

  it('reports unmuted topic as false', async () => {
    const muted = await isTopicMuted('deploy', mockEnv);
    expect(muted).toBe(false);
  });

  it('mutes a topic and returns expiration metadata', async () => {
    const result = await muteTopic('deploy', '2h', 'admin_user', mockEnv);
    expect(result.topic).toBe('deploy');
    expect(result.durationHuman).toBe('2 hours');
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    const isMutedNow = await isTopicMuted('deploy', mockEnv);
    expect(isMutedNow).toBe(true);
  });

  it('normalizes topic names to lowercase and trims whitespace', async () => {
    await muteTopic('  Database ', '1h', 'admin_user', mockEnv);
    expect(await isTopicMuted('database', mockEnv)).toBe(true);
    expect(await isTopicMuted('Database', mockEnv)).toBe(true);
  });

  it('unmutes a topic', async () => {
    await muteTopic('alerts', '24h', 'admin_user', mockEnv);
    expect(await isTopicMuted('alerts', mockEnv)).toBe(true);

    const unmuted = await unmuteTopic('alerts', mockEnv);
    expect(unmuted).toBe(true);
    expect(await isTopicMuted('alerts', mockEnv)).toBe(false);
  });

  it('lists active muted topics', async () => {
    await muteTopic('deploy', '1h', 'user_a', mockEnv);
    await muteTopic('billing', '2h', 'user_b', mockEnv);

    const list = await listMutedTopics(mockEnv);
    expect(list.length).toBe(2);
    expect(list.map((m) => m.topic)).toContain('deploy');
    expect(list.map((m) => m.topic)).toContain('billing');
  });

  it('returns false safely when KV is not bound', async () => {
    const envWithoutKv: Env = { TELEGRAM_BOT_TOKEN: 'mock_token' };
    expect(await isTopicMuted('deploy', envWithoutKv)).toBe(false);
    expect(await listMutedTopics(envWithoutKv)).toEqual([]);
  });
});
