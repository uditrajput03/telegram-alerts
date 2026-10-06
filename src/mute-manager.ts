import { Env } from './types';
import { parseDuration } from './token-manager';

export interface MutedTopicEntry {
  topic: string;
  mutedUntil: number;
  mutedBy: string;
  durationHuman?: string;
  createdAt: number;
}

/**
 * Checks whether a topic is currently muted in Cloudflare KV
 */
export async function isTopicMuted(topicName: string, env: Env): Promise<boolean> {
  if (!env.GATEWAY_KV || !topicName) return false;
  const clean = topicName.trim().toLowerCase();

  try {
    const raw = await env.GATEWAY_KV.get(`mute:${clean}`, 'json');
    if (!raw) return false;

    const data = raw as { mutedUntil?: number };
    if (data.mutedUntil && data.mutedUntil < Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Mutes a topic in Cloudflare KV for the specified duration
 */
export async function muteTopic(
  topicName: string,
  durationStr: string | undefined,
  mutedBy: string,
  env: Env
): Promise<{ topic: string; durationHuman: string; expiresAt: number }> {
  if (!env.GATEWAY_KV) {
    throw new Error('Cloudflare KV (GATEWAY_KV) is not bound.');
  }

  const clean = topicName.trim().toLowerCase();
  if (!clean) {
    throw new Error('Topic name cannot be empty.');
  }

  const { seconds, human } = parseDuration(durationStr);
  const now = Date.now();
  const expiresAt = now + seconds * 1000;

  const entry: MutedTopicEntry = {
    topic: clean,
    mutedUntil: expiresAt,
    mutedBy,
    durationHuman: human,
    createdAt: now,
  };

  // 1. Put key in KV with expiration TTL
  await env.GATEWAY_KV.put(`mute:${clean}`, JSON.stringify(entry), {
    expirationTtl: seconds,
  });

  // 2. Update mutes index in KV
  try {
    const existing = await listMutedTopics(env);
    const updated = [
      ...existing.filter((m) => m.topic !== clean),
      { topic: clean, mutedUntil: expiresAt, mutedBy },
    ];
    await env.GATEWAY_KV.put('mutes:index', JSON.stringify(updated));
  } catch (err) {
    console.warn('[MuteManager] Failed to update mutes index in KV:', err);
  }

  return { topic: clean, durationHuman: human, expiresAt };
}

/**
 * Unmutes a topic by removing its key and updating the index in Cloudflare KV
 */
export async function unmuteTopic(topicName: string, env: Env): Promise<boolean> {
  if (!env.GATEWAY_KV) return false;
  const clean = topicName.trim().toLowerCase();
  if (!clean) return false;

  try {
    await env.GATEWAY_KV.delete(`mute:${clean}`);

    const existing = await listMutedTopics(env);
    const updated = existing.filter((m) => m.topic !== clean);
    await env.GATEWAY_KV.put('mutes:index', JSON.stringify(updated));
    return true;
  } catch (err) {
    console.warn('[MuteManager] Failed to unmute topic:', err);
    return false;
  }
}

/**
 * Lists all actively muted topics from Cloudflare KV, filtering expired ones
 */
export async function listMutedTopics(
  env: Env
): Promise<Array<{ topic: string; mutedUntil: number; mutedBy: string }>> {
  if (!env.GATEWAY_KV) return [];

  try {
    const raw = await env.GATEWAY_KV.get('mutes:index', 'json');
    if (!raw || !Array.isArray(raw)) return [];

    const now = Date.now();
    return (raw as Array<{ topic: string; mutedUntil: number; mutedBy: string }>).filter(
      (m) => m.mutedUntil > now
    );
  } catch {
    return [];
  }
}
