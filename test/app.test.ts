import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index';
import { Env } from '../src/types';
import { createStoredToken } from '../src/token-manager';
import { muteTopic } from '../src/mute-manager';

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

describe('Gateway HTTP API (Hono app)', () => {
  let mockKv: KVNamespace;
  let mockEnv: Env;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockKv = new MockKVNamespace() as unknown as KVNamespace;
    mockEnv = {
      TELEGRAM_BOT_TOKEN: 'mock_bot_token',
      TELEGRAM_CHAT_ID: '-1001234567890',
      AUTH_TOKEN: 'test-secret-token',
      UNKNOWN_TOPIC_ID: '99',
      CATCHALL_TOPIC_ID: '88',
      GATEWAY_KV: mockKv,
    };
  });

  it('GET /health returns 200 and healthy status', async () => {
    const res = await app.request('/health', {}, mockEnv);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe('healthy');
  });

  it('recovers unstructured payloads into catchall topic rather than dropping them', async () => {
    let capturedBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 1001, message_thread_id: 88, chat: { id: -1001234567890 } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-token',
        },
        body: JSON.stringify({ custom_unformatted_field: 'some raw data' }),
      },
      mockEnv
    );

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.is_catchall).toBe(true);
    expect(data.topic).toBe('catchall');
    expect(capturedBody.text).toContain('Catch-All Recovery');
    expect(capturedBody.text).toContain('custom_unformatted_field');
  });

  it('handles unverified requests by marking is_verified: false, silent: true, and routing to UNKNOWN topic', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/sendMessage')) {
        const body = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 1234,
              message_thread_id: body.message_thread_id,
              date: 1234567,
              chat: { id: -1001234567890, type: 'supergroup' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Third-party alert without token',
          topic: 'custom-topic',
        }),
      },
      mockEnv
    );

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.is_verified).toBe(false);
    expect(data.silent).toBe(true);
    expect(data.topic).toBe('unknown');
    expect(data.topic_id).toBe(99);

    expect(fetchSpy).toHaveBeenCalled();
    const telegramCall = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(telegramCall.message_thread_id).toBe(99);
    expect(telegramCall.disable_notification).toBe(true);
    expect(telegramCall.text).toContain('Unverified Source');
  });

  it('accepts authenticated requests via static env AUTH_TOKEN', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 5678,
            date: 1234567,
            chat: { id: -1001234567890, type: 'supergroup' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-secret-token',
        },
        body: JSON.stringify({
          message: 'Authenticated deployment complete',
          topic: 'deploy',
        }),
      },
      mockEnv
    );

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.is_verified).toBe(true);
    expect(data.token_type).toBe('env');
  });

  it('dynamically creates a new Telegram forum topic when topic is unmapped and caches in KV', async () => {
    let createTopicCalled = 0;
    let sendMessageThreadId = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/createForumTopic')) {
        createTopicCalled++;
        return new Response(
          JSON.stringify({
            ok: true,
            result: { message_thread_id: 555, name: 'Billing', icon_color: 0x8EEE98 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('/sendMessage')) {
        const body = JSON.parse(init.body);
        sendMessageThreadId = body.message_thread_id;
        return new Response(
          JSON.stringify({
            ok: true,
            result: { message_id: 9991, message_thread_id: 555, date: 1234567, chat: { id: -1001234567890, type: 'supergroup' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    // First request: should call createForumTopic
    const res1 = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-token',
        },
        body: JSON.stringify({
          title: 'Invoice Paid',
          message: 'Received $200',
          topic: 'billing',
        }),
      },
      mockEnv
    );

    expect(res1.status).toBe(200);
    const data1 = await res1.json() as any;
    expect(data1.success).toBe(true);
    expect(data1.topic).toBe('billing');
    expect(data1.topic_id).toBe(555);
    expect(createTopicCalled).toBe(1);
    expect(sendMessageThreadId).toBe(555);

    // Verify it was saved to KV
    const cachedTopic = await mockKv.get('topic:billing');
    expect(cachedTopic).toBe('555');

    // Second request: should read from KV and NOT call createForumTopic again
    const res2 = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-token',
        },
        body: JSON.stringify({
          title: 'Second Invoice Paid',
          message: 'Received $500',
          topic: 'billing',
        }),
      },
      mockEnv
    );

    expect(res2.status).toBe(200);
    const data2 = await res2.json() as any;
    expect(data2.topic_id).toBe(555);
    expect(createTopicCalled).toBe(1); // Still 1, didn't call again!
  });

  it('accepts authenticated requests via KV bot-generated ephemeral token', async () => {
    const { token: ephToken } = await createStoredToken(mockEnv, {
      type: 'ephemeral',
      duration: '1h',
      label: 'temp-session',
      createdBy: 'admin',
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 8888,
            date: 1234567,
            chat: { id: -1001234567890, type: 'supergroup' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request(
      `/notify?token=${ephToken.token}&message=Ephemeral+Alert&topic=general`,
      { method: 'GET' },
      mockEnv
    );

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.is_verified).toBe(true);
    expect(data.token_type).toBe('ephemeral');
  });

  it('enforces quarantine: unverified requests cannot bypass unknown topic even with explicit topic_id (SEC-03)', async () => {
    let deliveredThreadId: number | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      deliveredThreadId = body.message_thread_id;
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 2001,
            message_thread_id: 99,
            chat: { id: -1001234567890 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Attempted topic bypass without auth',
          topic_id: 1234, // Attempting to route to thread 1234
        }),
      },
      mockEnv
    );

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.is_verified).toBe(false);
    expect(data.topic).toBe('unknown');
    // Thread must be quarantined to UNKNOWN_TOPIC_ID (99), NOT 1234
    expect(deliveredThreadId).toBe(99);
  });

  it('rejects empty payload / scanner probes with 400 Bad Request (SEC-04)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      mockEnv
    );

    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.success).toBe(false);
    expect(data.error).toContain('Missing content');
    // Ensure fetch to Telegram was NOT triggered
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('verifies /debug-chat endpoint is removed for security', async () => {
    const resDebug = await app.request('/debug-chat', { method: 'GET' }, mockEnv);
    expect(resDebug.status).toBe(404);
  });

  it('handles POST /telegram-webhook updates cleanly (/id command) when secret is valid', async () => {
    let capturedReply = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      capturedReply = init.body;
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 100 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 50,
            from: { id: 12345, is_bot: false, first_name: 'Udit', username: 'udit' },
            chat: { id: -1001234567890, type: 'supergroup' },
            date: 1234567,
            text: '/id',
          },
        }),
      },
      {
        ...mockEnv,
        TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
      }
    );

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(capturedReply).toContain('-1001234567890');
  });

  it('strictly rejects /telegram-webhook if TELEGRAM_WEBHOOK_SECRET is not configured', async () => {
    const res = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1, message: { text: '/help' } }),
      },
      mockEnv // mockEnv has no TELEGRAM_WEBHOOK_SECRET
    );

    expect(res.status).toBe(401);
  });

  it('strictly rejects /setup-webhook if TELEGRAM_WEBHOOK_SECRET is not configured', async () => {
    const res = await app.request(
      '/setup-webhook',
      { headers: { 'x-api-key': 'valid-static-token' } },
      { ...mockEnv, AUTH_TOKEN: 'valid-static-token' } // missing TELEGRAM_WEBHOOK_SECRET
    );

    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain('TELEGRAM_WEBHOOK_SECRET is required');
  });

  it('handles /setup-webhook to register webhook with Telegram API when secret is configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('/setWebhook')) {
        return new Response(
          JSON.stringify({ ok: true, result: true, description: 'Webhook was set' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res = await app.request('/setup-webhook', {
      headers: { 'x-api-key': 'valid-static-token' },
    }, {
      ...mockEnv,
      AUTH_TOKEN: 'valid-static-token',
      TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.webhook_url).toContain('/telegram-webhook');
  });

  it('rejects /telegram-webhook if secret token does not match TELEGRAM_WEBHOOK_SECRET', async () => {
    const res = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'wrong-secret',
        },
        body: JSON.stringify({
          update_id: 99,
          message: {
            message_id: 50,
            from: { id: 12345, is_bot: false, first_name: 'Udit' },
            chat: { id: -1001234567890, type: 'supergroup' },
            text: '/help',
          },
        }),
      },
      {
        ...mockEnv,
        TELEGRAM_WEBHOOK_SECRET: 'correct-secret',
      }
    );

    expect(res.status).toBe(401);
  });

  it('rejects unauthorized users from generating tokens via bot', async () => {
    let capturedReply = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/getChatMember')) {
        return new Response(
          JSON.stringify({ ok: true, result: { status: 'member', user: { id: 99999 } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('/sendMessage')) {
        capturedReply = init.body;
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 101 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          update_id: 2,
          message: {
            message_id: 51,
            from: { id: 99999, is_bot: false, first_name: 'Attacker' },
            chat: { id: -1001234567890, type: 'supergroup' },
            date: 1234567,
            text: '/token permanent rogue',
          },
        }),
      },
      {
        ...mockEnv,
        TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(capturedReply).toContain('Access Denied');
  });

  it('allows verified admin to generate token via bot', async () => {
    let capturedReply = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/getChatMember')) {
        return new Response(
          JSON.stringify({ ok: true, result: { status: 'creator', user: { id: 12345 } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('/sendMessage')) {
        capturedReply = init.body;
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 102 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          update_id: 3,
          message: {
            message_id: 52,
            from: { id: 12345, is_bot: false, first_name: 'Owner', username: 'owner' },
            chat: { id: -1001234567890, type: 'supergroup' },
            date: 1234567,
            text: '/token permanent prod-key',
          },
        }),
      },
      {
        ...mockEnv,
        TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(capturedReply).toContain('Permanent Token Generated');
    expect(capturedReply).toContain('tg_perm_');
  });

  it('routes /notify/message=hello to catchall topic', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/sendMessage')) {
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 2001,
              message_thread_id: capturedBody.message_thread_id,
              date: 1234567,
              chat: { id: -1001234567890, type: 'supergroup' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res = await app.request('/notify/message=hello', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.is_catchall).toBe(true);
    expect(data.topic).toBe('catchall');
    expect(capturedBody.message_thread_id).toBe(88); // CATCHALL_TOPIC_ID
    expect(capturedBody.text).toContain('/notify/message=hello');
    expect(capturedBody.text).toContain('hello');
  });

  it('routes /notify/hello/world to catchall topic', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/sendMessage')) {
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 2002,
              message_thread_id: capturedBody.message_thread_id,
              date: 1234567,
              chat: { id: -1001234567890, type: 'supergroup' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res = await app.request('/notify/hello/world', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.is_catchall).toBe(true);
    expect(data.topic).toBe('catchall');
    expect(capturedBody.message_thread_id).toBe(88); // CATCHALL_TOPIC_ID
    expect(capturedBody.text).toContain('hello');
    expect(capturedBody.text).toContain('world');
  });

  it('routes /notify?m=hello&t=world to catchall topic', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/sendMessage')) {
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 2003,
              message_thread_id: capturedBody.message_thread_id,
              date: 1234567,
              chat: { id: -1001234567890, type: 'supergroup' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const res = await app.request('/notify?m=hello&t=world', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.is_catchall).toBe(true);
    expect(data.topic).toBe('catchall');
    expect(capturedBody.message_thread_id).toBe(88); // CATCHALL_TOPIC_ID
    expect(capturedBody.text).toContain('world');
    expect(capturedBody.text).toContain('hello');
  });

  it('self-heals: when a cached topic thread is deleted in Telegram, purges KV, recreates topic, and delivers to the new topic', async () => {
    // 1. Pre-seed KV with stale topic ID 555
    await mockKv.put('topic:database', '555');

    let createTopicCalled = 0;
    let deliveredThreadId: number | undefined;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/sendMessage')) {
        const body = JSON.parse(init.body);
        // Stale thread 555 fails with message thread not found
        if (body.message_thread_id === 555) {
          return new Response(
            JSON.stringify({
              ok: false,
              error_code: 400,
              description: 'Bad Request: message thread not found',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // New thread 777 succeeds!
        deliveredThreadId = body.message_thread_id;
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 3001,
              message_thread_id: body.message_thread_id,
              date: 1234567,
              chat: { id: -1001234567890, type: 'supergroup' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('/createForumTopic')) {
        createTopicCalled++;
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_thread_id: 777,
              name: 'Database',
              icon_color: 0x6FB9F0,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not found', { status: 404 });
    });

    const res = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-token',
        },
        body: JSON.stringify({
          topic: 'database',
          message: 'Postgres restored',
        }),
      },
      mockEnv
    );

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.topic).toBe('database');
    expect(data.topic_id).toBe(777); // Delivered to new thread 777!
    expect(createTopicCalled).toBe(1); // Auto-recreated!
    expect(deliveredThreadId).toBe(777);

    // KV must now hold the new thread ID 777
    const updatedKv = await mockKv.get('topic:database');
    expect(updatedKv).toBe('777');
  });

  it('silences alerts delivered to a muted topic', async () => {
    let deliveredSilent = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      deliveredSilent = body.disable_notification;
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 300 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    // Mute "deploy" topic in KV
    await muteTopic('deploy', '2h', 'admin', mockEnv);

    const res = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-token',
        },
        body: JSON.stringify({
          topic: 'deploy',
          message: 'Deploy completed',
        }),
      },
      mockEnv
    );

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.silent).toBe(true);
    expect(deliveredSilent).toBe(true);
  });

  it('handles /status command via telegram webhook', async () => {
    let capturedReply = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      capturedReply = init.body;
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 301 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 51,
            from: { id: 12345, is_bot: false, first_name: 'Admin' },
            chat: { id: -1001234567890, type: 'supergroup' },
            date: 1234567,
            text: '/status',
          },
        }),
      },
      {
        ...mockEnv,
        TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
        ADMIN_USER_ID: '12345',
      }
    );

    expect(res.status).toBe(200);
    expect(capturedReply).toContain('Gateway System Status');
    expect(capturedReply).toContain('Operational');
  });

  it('handles /mute and /unmute commands via telegram webhook', async () => {
    let capturedReply = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      capturedReply = init.body;
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 302 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const webhookEnv = {
      ...mockEnv,
      TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
      ADMIN_USER_ID: '12345',
    };

    // 1. Send /mute ci 2h
    const muteRes = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          update_id: 2,
          message: {
            message_id: 52,
            from: { id: 12345, is_bot: false, first_name: 'Admin', username: 'admin' },
            chat: { id: -1001234567890, type: 'supergroup' },
            date: 1234567,
            text: '/mute ci 2h',
          },
        }),
      },
      webhookEnv
    );

    expect(muteRes.status).toBe(200);
    expect(capturedReply).toContain('Topic Muted');
    expect(capturedReply).toContain('#ci');

    // 2. Send /unmute ci
    const unmuteRes = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          update_id: 3,
          message: {
            message_id: 53,
            from: { id: 12345, is_bot: false, first_name: 'Admin' },
            chat: { id: -1001234567890, type: 'supergroup' },
            date: 1234568,
            text: '/unmute ci',
          },
        }),
      },
      webhookEnv
    );

    expect(unmuteRes.status).toBe(200);
    expect(capturedReply).toContain('Topic Unmuted');
  });

  it('handles /test command via telegram webhook', async () => {
    let capturedBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/sendMessage')) {
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 303 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const res = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          update_id: 4,
          message: {
            message_id: 54,
            from: { id: 12345, is_bot: false, first_name: 'Admin' },
            chat: { id: -1001234567890, type: 'supergroup' },
            date: 1234569,
            text: '/test general',
          },
        }),
      },
      {
        ...mockEnv,
        TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
        ADMIN_USER_ID: '12345',
      }
    );

    expect(res.status).toBe(200);
    expect(capturedBody).toBeDefined();
    expect(capturedBody.text).toContain('Test Notification Dispatched');
  });

  it('handles /docs command via telegram webhook', async () => {
    let capturedReply = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      capturedReply = init.body;
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 304 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/telegram-webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          update_id: 5,
          message: {
            message_id: 55,
            from: { id: 12345, is_bot: false, first_name: 'User' },
            chat: { id: -1001234567890, type: 'supergroup' },
            date: 1234570,
            text: '/docs',
          },
        }),
      },
      {
        ...mockEnv,
        TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
      }
    );

    expect(res.status).toBe(200);
    expect(capturedReply).toContain('API &amp; Webhook Documentation');
    expect(capturedReply).toContain('/notify');
    expect(capturedReply).toContain('curl');
    expect(capturedReply).toContain('message');
  });

  describe('/send route (inbox topic)', () => {
    it('GET /send returns 200 with minimal HTML form', async () => {
      const res = await app.request('/send', {}, mockEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Send Message');
      expect(html).toContain('#inbox');
      expect(html).toContain('<textarea');
      expect(html).toContain('</form>');
    });

    it('POST /send defaults destination topic to inbox and delivers to Telegram', async () => {
      let capturedBody: any;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/sendMessage')) {
          capturedBody = JSON.parse(init.body);
          return new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 888, message_thread_id: 333, chat: { id: -1001234567890 } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('/createForumTopic')) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: { message_thread_id: 333, name: 'Inbox', icon_color: 0x6FB9F0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200 });
      });

      const res = await app.request(
        '/send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'test-secret-token',
          },
          body: JSON.stringify({
            message: 'Note for inbox',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.topic).toBe('inbox');
      expect(capturedBody).toBeDefined();
      expect(capturedBody.text).toContain('Note for inbox');
    });

    it('POST /send with HTML accept header returns rendered HTML with sent status', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, _init: any) => {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { message_id: 889, message_thread_id: 333, chat: { id: -1001234567890 } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await app.request(
        '/send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html',
            'x-api-key': 'test-secret-token',
          },
          body: 'message=Hello+from+form',
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Sent to #inbox!');
    });

    it('POST /send without authentication ALWAYS delivers to inbox topic and omits unverified badge', async () => {
      let capturedBody: any;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/sendMessage')) {
          capturedBody = JSON.parse(init.body);
          return new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 890, message_thread_id: 333, chat: { id: -1001234567890 } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('/createForumTopic')) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: { message_thread_id: 333, name: 'Inbox', icon_color: 0x6FB9F0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200 });
      });

      // No x-api-key header! Totally unauthenticated!
      const res = await app.request(
        '/send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: 'Unauthenticated note to inbox',
          }),
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.is_verified).toBe(false);
      expect(data.topic).toBe('inbox');
      expect(data.topic_id).toBe(333);
      expect(data.silent).toBe(false);
      expect(capturedBody).toBeDefined();
      expect(capturedBody.message_thread_id).toBe(333);
      expect(capturedBody.text).toContain('Unauthenticated note to inbox');
      // Must NOT contain the unverified source badge
      expect(capturedBody.text).not.toContain('Unverified Source');
    });

    it('POST /send with query message and empty body delivers to inbox', async () => {
      let capturedThreadId: number | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/sendMessage')) {
          const body = JSON.parse(init.body);
          capturedThreadId = body.message_thread_id ?? null;
          return new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 891, message_thread_id: 333, chat: { id: -1001234567890 } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('/createForumTopic')) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: { message_thread_id: 333, name: 'Inbox', icon_color: 0x6FB9F0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200 });
      });

      const res = await app.request(
        '/send?message=Query+Note',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '',
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.topic).toBe('inbox');
      expect(capturedThreadId).toBe(333);
    });

    it('POST /send with empty message and HTML accept returns 400 HTML with error', async () => {
      const res = await app.request(
        '/send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html',
          },
          body: 'message=',
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Missing content');
    });
  });

  it('safely handles literal percent signs in URI path without crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 4001, message_thread_id: 88, chat: { id: -1001234567890 } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request('/notify/Disk+Usage+95%?token=test-secret-token', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
  });

  it('rejects unauthenticated bot scanner probes on /notify/* with 400 Bad Request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.request('/notify/wp-login.php', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.success).toBe(false);
    expect(data.error).toContain('Missing content');
    expect(fetchSpy).not.toHaveBeenCalled();

    const resEnv = await app.request('/notify/.env', { method: 'GET' }, mockEnv);
    expect(resEnv.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes unauthenticated standard GET requests to UNKNOWN topic', async () => {
    let deliveredThreadId: number | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      deliveredThreadId = body.message_thread_id;
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 4002, message_thread_id: 99, chat: { id: -1001234567890 } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request('/notify?message=Public+alert', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.is_verified).toBe(false);
    expect(data.topic).toBe('unknown');
    expect(data.topic_id).toBe(99);
    expect(deliveredThreadId).toBe(99);
  });

  it('falls back to plain text delivery when Telegram returns 400 HTML entity parse error', async () => {
    let callCount = 0;
    let fallbackBody: any = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);

      // First call with HTML parse mode fails with entity parse error
      if (body.parse_mode === 'HTML') {
        return new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: can't parse entities: Character '<' is reserved",
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Second call (plain text fallback without parse_mode) succeeds!
      fallbackBody = body;
      return new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 4003, date: 1234567, chat: { id: -1001234567890, type: 'supergroup' } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/notify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-token',
        },
        body: JSON.stringify({
          message: 'Alert with broken entity <invalid>',
          topic: 'general',
        }),
      },
      mockEnv
    );

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(callCount).toBe(2);
    expect(fallbackBody.parse_mode).toBeUndefined();
  });
});
