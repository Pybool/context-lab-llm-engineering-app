import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { JsonStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import type { LabConfig } from '../src/config.js';
import type { ChatMessage } from '../src/tokenizer.js';

test('TOK-006 rejects growing history without mutations or LLM invocation', async (t) => {
  const temporaryDir = await mkdtemp(join(tmpdir(), 'llm-lab-test-'));
  t.after(async () => { await rm(temporaryDir, { recursive: true, force: true }); });
  const store = await JsonStore.open(join(temporaryDir, 'db.json'));
  const cfg: LabConfig = {
    http: { port: 0, allowedOrigin: 'http://localhost:3000' },
    model: { ollamaUrl: 'http://127.0.0.1:11434', name: 'stub', contextWindowTokens: 4096, outputTokens: 20, temperature: 0.2, timeoutMs: 10000 },
    budget: { policyLimitTokens: 1024, safetyMarginTokens: 10, overLimitAction: 'reject' },
    systemPrompt: 'This is a critical system instruction that must never be removed.',
  };
  const counter = async (messages: ChatMessage[]) => messages.reduce((total, m) => total + Math.ceil(m.content.length / 4) + 8, 0);
  let ollamaCalls = 0;
  const app = createApp({ store, loadConfiguration: async () => cfg, countTokens: counter,
    generate: async () => { ollamaCalls++; return { text: 'A valid answer.', promptEvalCount: 20, evalCount: 5, doneReason: 'stop' }; },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = '';
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: cfg.http.allowedOrigin } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0] ?? '';
    const json = await response.json() as Record<string, any>;
    return { status: response.status, json };
  }

  const register = await request('/auth/register', 'POST', { email: 'tester@example.test', password: 'a-secure-test-password' });
  assert.equal(register.status, 201);
  const created = await request('/chats', 'POST', { title: 'TOK-006 test' });
  assert.equal(created.status, 201);
  const chatId: string = created.json.chat.id;
  for (let i = 0; i < 4; i++) {
    const posted = await request(`/chats/${chatId}/messages`, 'POST', { content: `Message ${i} for a persistent conversation.` });
    assert.equal(posted.status, 201);
  }
  const before = await request(`/chats/${chatId}`);
  const persistedBefore = await readFile(join(temporaryDir, 'db.json'), 'utf8');
  assert.equal(before.json.messages.length, 8);
  assert.equal(ollamaCalls, 4);
  const candidate = 'A final message that pushes the budget beyond the limit.';
  const testMessages: ChatMessage[] = [
    { role: 'system', content: cfg.systemPrompt },
    ...before.json.messages.map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, content: m.content })),
    { role: 'user', content: candidate },
  ];
  const required = await counter(testMessages) + cfg.budget.safetyMarginTokens + cfg.model.outputTokens;
  cfg.budget.policyLimitTokens = required - 1; // Exactly one estimated token above the new policy limit.

  const rejected = await request(`/chats/${chatId}/messages`, 'POST', { content: candidate });
  assert.equal(rejected.status, 413);
  assert.equal(rejected.json.error.code, 'CONTEXT_LIMIT_EXCEEDED');
  assert.equal(rejected.json.error.details.budget.remainingTokens, -1);
  assert.equal(ollamaCalls, 4, 'Ollama must not be called for rejected requests');
  const after = await request(`/chats/${chatId}`);
  assert.deepEqual(after.json, before.json, 'Full conversation content, ordering and metadata must be unchanged');
  const persistedAfter = await readFile(join(temporaryDir, 'db.json'), 'utf8');
  assert.equal(persistedAfter, persistedBefore, 'Underlying JSON database file must not be rewritten on rejection');
});
