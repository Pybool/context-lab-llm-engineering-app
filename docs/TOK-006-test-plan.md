# TOK-006 — History growth, rejection and integrity

## What is being tested?

The **chat gateway** must correctly include all retained conversation history and the incoming user message in a token-budget estimate. When the candidate request exceeds the policy limit, the gateway must reject **before** calling Ollama and **must not mutate** stored history.

This goes beyond `BudgetPolicy` arithmetic (TOK-001 to TOK-005): storage, history reconstruction, authentication, ownership, real HTTP routing, and model-call gating are covered.

## Automated test

`npm test` runs `apps/server/tests/history.test.ts` (plus pure policy tests). A real HTTP listener, cookie login, local persistent JSON store and configurable chat context are exercised. Only the external model transport and token counter are controlled fakes, so the overflow is deterministic.

Assertions:
1. Chat created by logged-in user; 4 turns succeed and persist.
2. Policy limit changed in test to one token below candidate projected total.
3. `POST /api/chats/:id/messages` returns `413 CONTEXT_LIMIT_EXCEEDED`.
4. Model transport invocation count does not increase.
5. Complete `GET /api/chats/:id` response is identical before and after, including ordering.
6. Persisted database file bytes are identical before and after.

## Manual full-stack test using Ollama

1. Start Ollama, server, web (`npm run dev`); create a user and a chat.
2. Send two or three messages. Observe model replies, and `Actual input` in output metadata.
3. Read the current policy from `apps/server/config/lab.config.json`.
4. Reduce `budget.policyLimitTokens` to a small value that is greater than `model.outputTokens + budget.safetyMarginTokens` but **less than the inspector's projected total for your next prompt**.
5. Click the settings icon in the inspector to reload settings. Type the prompt and confirm preview says **Request would be rejected**.
6. Submit. Observe a rejection notice and an API terminal `[budget:reject]` log.
7. Verify there is **no** corresponding `[model:request]` log entry for the rejected message.
8. Refresh the browser and verify the prior user and assistant messages remain unchanged and in the same order. The rejected user message must not appear.
9. Restore the original budget policy value in the JSON file.

## Negative and isolation follow-ups

- Attempt accessing another user's chat by guessing the conversation ID: expect 404.
- Send a blank message: expect 400; no persistence.
- Send a request while the model server is stopped: expect server failure, with no new persisted user/assistant turn.
- Simulate two overlapping sends to one chat: verify they are serialized and see up-to-date history.
- Extend TOK-006 to use additional repository adapters (SQLite, PostgreSQL, external API) without changing API-level assertions.

## Limitations

The Qwen tokenizer's chat-template estimate is **not identical by guarantee** to the tokens Ollama ultimately processes. Only the arithmetic and application reject-on-overflow policy are deterministic. Native model behavior and potential internal truncation require separate provider-level tests and comparison against Ollama's `prompt_eval_count`.
