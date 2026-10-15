# ContextLab — local LLM context-window QA application

A lightweight **Next.js 16 / React 19** interface and separate **Express 5 / TypeScript** server. Runs **Qwen2.5:1.5b through Ollama**, authenticates users, saves conversation history to a local JSON data file, previews projected token budgets, and **rejects over-limit requests without invoking the model or changing persisted history**.

Designed as a *local single-process learning/test application*, **not an internet-exposed production SaaS**. There are no cloud API keys or `.env` files.

## Requirements

- Windows 11, Node.js 22+ (`node --version`), npm, VS Code.
- Ollama installed, with `qwen2.5:1.5b` pulled.
- Internet access once for npm packages and tokenizer JSON files (no credentials needed).

## Setup (PowerShell)

From the root folder (containing this README and root `package.json`):

```powershell
ollama pull qwen2.5:1.5b
npm install
npm run tokenizer:setup
npm run dev
```

Open **http://localhost:3000**. Register with an email and a password of at least 10 characters. Use the chat interface to create a conversation and send messages.

`npm run dev` starts both the web app on `localhost:3000` and the API at `127.0.0.1:4000`. Next.js rewrites `/api/*` requests to the backend (no browser CORS configuration or exposed token required).

## Configure token limits without .env

Edit **`apps/server/config/lab.config.json`**:

```json
{
  "http": {"port": 4000, "allowedOrigin": "http://localhost:3000"},
  "model": {
    "ollamaUrl": "http://127.0.0.1:11434",
    "name": "qwen2.5:1.5b",
    "contextWindowTokens": 4096,
    "outputTokens": 256,
    "temperature": 0.2,
    "timeoutMs": 120000
  },
  "budget": {
    "policyLimitTokens": 1024,
    "safetyMarginTokens": 32,
    "overLimitAction": "reject"
  },
  "systemPrompt": "Your configurable system instruction here."
}
```

The API reads this file for **each request**, so edits to `budget.policyLimitTokens`, `model.outputTokens`, `systemPrompt`, or other runtime values take effect immediately, without restart. **Changing `http.port` requires restarting the backend and updating `apps/web/next.config.ts` accordingly.**

- `model.contextWindowTokens` controls Ollama's `num_ctx`.
- `budget.policyLimitTokens` controls the **app's stricter preflight policy**. Must be <= Ollama context window.
- `model.outputTokens` is passed to Ollama as `num_predict` and reserved before sending.
- `budget.safetyMarginTokens` is additional estimated accounting capacity.
- Only `"overLimitAction": "reject"` is supported. The backend does **not** truncate or compact conversation history.
- An invalid config fails requests with a server error instead of silently continuing with the wrong settings.

To trigger TOK-006, first build history with a few messages, then reduce `budget.policyLimitTokens` in the file (keep it above `outputTokens + safetyMarginTokens`). Type and send the next message. Observe **HTTP 413**, unchanged chat history, and no new Ollama request. The composer inspector previews the budget before you submit.

## Routes

| Route | Auth? | Action |
| --- | --- | --- |
| `POST /api/auth/register` | No | Create user + session cookie |
| `POST /api/auth/login` | No | Log in |
| `POST /api/auth/logout` | No | End session |
| `GET /api/auth/me` | No | Current user |
| `GET /api/config` | Yes | Read public server test settings |
| `GET /api/chats` | Yes | List own conversations |
| `POST /api/chats` | Yes | Create conversation |
| `GET /api/chats/:id` | Yes | Load own history |
| `POST /api/chats/:id/preview` | Yes | Read-only budget preview for candidate message |
| `POST /api/chats/:id/messages` | Yes | Preflight -> Ollama -> atomically save user and assistant messages |

On overflow, sending returns **413** with an error code of `CONTEXT_LIMIT_EXCEEDED` and the computed budget diagnostics. No user/assistant message is saved and Ollama is never contacted.

## Automated tests

```powershell
npm test
```

- **TOK-001, TOK-002, TOK-003, TOK-005:** deterministic, isolated budget-policy tests.
- **TOK-006:** real HTTP integration against an authenticated chat service and temporary persistent JSON store, with a fake model transport. It creates several messages, reduces the policy limit so the next message exceeds by one token, asserts HTTP 413, checks that Ollama was not invoked, and compares the full persisted conversation before/after. No actual LLM is required for these deterministic regression tests.

For real-model inspection, launch Ollama and send messages through the browser. Each assistant reply displays estimated input vs actual `prompt_eval_count`, actual `eval_count`, and `done_reason` returned by Ollama.

## Design and accuracy limitations

1. The preflight counter uses the real **Qwen2.5 tokenizer files** (downloaded once) and a hand-assembled Qwen chat template. Ollama's actual template and internal accounting can differ. `prompt_eval_count` is the ground truth **after processing**, not a preflight guarantee. The safety margin helps but does not guarantee that provider-side truncation is impossible. Calibrate the estimator and fail closed on unexplained overcount discrepancies before depending on it in production.
2. JSON persistence uses atomic file replacement and serialized in-process writes. It is intended for a **local single-process lab**, not multiple server replicas. Use a transactional database (PostgreSQL/SQLite) and proper migrations for production.
3. Accounts use salted scrypt password hashes and opaque HttpOnly cookies, with basic rate limiting and origin checks. The project deliberately binds backend to loopback and does not implement TLS, account recovery, monitoring, hardened secrets management, or public-deployment security.
4. No tool calling, attachments, RAG, or compaction yet. These are planned for later modules.
5. Requests are serialized **per chat** to avoid overlapping context decisions; accepted turns are persisted together after the model succeeds. Failed model generations do not save partial turns.
6. The web proxy destination assumes backend port 4000. The port isn't dynamically generated by the server config because the Next.js rewrite is compiled separately.

## Files to explore for the TOK-006 QA exercise

- `apps/server/src/store.ts`: history storage, atomic writes, per-chat locking
- `apps/server/src/tokenizer.ts`: local Qwen tokenizer and message formatting
- `apps/server/src/budget.ts`: pure token-budget policy
- `apps/server/src/app.ts`: full API, history assembly, decision and rejection
- `apps/server/config/lab.config.json`: model, policy and system instruction
- `apps/server/tests/history.test.ts`: real API test verifying no history loss and no model call
