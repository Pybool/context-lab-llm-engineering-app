import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import {
  loadConfig,
  publicConfig,
  tokenCountBody,
  type LabConfig,
} from "./config.js";
import { evaluateBudget } from "./budget.js";
import {
  countChatTokens,
  countTextTokens,
  type ChatMessage,
} from "./tokenizer.js";
import { JsonStore, KeyedQueue, type Conversation } from "./store.js";
import {
  createAccount,
  verifyCredentials,
  startSession,
  currentUser,
  endSession,
} from "./auth.js";
import { askOllama, type OllamaReply } from "./ollama.js";
import { createOllamaInvocationTracker } from "./ollama-invocations.js";

type Dependencies = {
  store: JsonStore;
  loadConfiguration?: () => Promise<LabConfig>;
  countTokens?: (messages: ChatMessage[]) => Promise<number>;
  generate?: (cfg: LabConfig, messages: ChatMessage[]) => Promise<OllamaReply>;
  countRawTokens?: (text: string) => Promise<number>;
};

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const credentials = z
  .object({ email: z.email().max(254), password: z.string().min(10).max(256) })
  .strict();
const newConversation = z
  .object({ title: z.string().trim().min(1).max(100).optional() })
  .strict();
const messageBody = z
  .object({ content: z.string().trim().min(1).max(50000) })
  .strict();

export function createApp(deps: Dependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  // Reject cross-site browser mutations even when a valid cookie is present.
  app.use(async (req, _res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }
    try {
      const cfg = await configLoader();
      const origin = req.headers.origin;
      if (origin && origin !== cfg.http.allowedOrigin) {
        throw new ApiError(
          403,
          "ORIGIN_FORBIDDEN",
          "Unexpected browser request origin.",
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  const queue = new KeyedQueue();
  const configLoader = deps.loadConfiguration ?? loadConfig;
  const tokenCounter = deps.countTokens ?? countChatTokens;
  const rawTokenCounter = deps.countRawTokens ?? countTextTokens;
  const ollama = deps.generate ?? askOllama;

  const { recordOllamaInvocation, getOllamaInvocationStats } =
    createOllamaInvocationTracker();

  function requireUser(req: Request) {
    const user = currentUser(deps.store, req);
    if (!user)
      throw new ApiError(401, "UNAUTHENTICATED", "Please log in first.");
    return user;
  }

  function getConversation(userId: string, id: string) {
    const conversation = deps.store.read((d) =>
      d.conversations.find((c) => c.id === id && c.userId === userId),
    );
    if (!conversation)
      throw new ApiError(404, "CHAT_NOT_FOUND", "Conversation not found.");
    return conversation;
  }

  async function preview(
    cfg: LabConfig,
    conversation: Conversation,
    content: string,
  ) {
    const saved = deps.store.read((d) =>
      d.messages
        .filter((m) => m.conversationId === conversation.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
    const messages: ChatMessage[] = [
      { role: "system", content: cfg.systemPrompt },
      ...saved.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content },
    ];
    const inputTokens = await tokenCounter(messages);
    const decision = evaluateBudget({
      inputTokens,
      overheadTokens: cfg.budget.safetyMarginTokens,
      reservedOutputTokens: cfg.model.outputTokens,
      contextLimit: cfg.budget.policyLimitTokens,
    });
    return { messages, decision, historyMessageCount: saved.length };
  }

  // JSON configuration lives only on the server; reloaded on every request.
  app.get("/api/health", async (_req, res) => {
    const cfg = await configLoader();
    res.json({ status: "ok", model: cfg.model.name });
  });

  app.get("/api/config", async (req, res) => {
    requireUser(req);
    res.json(publicConfig(await configLoader()));
  });

  // Password auth and opaque HttpOnly cookie sessions. This is for local QA use.
  const attempts = new Map<string, { count: number; resets: number }>();
  function limitAuth(req: Request, _res: Response, next: NextFunction) {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const item = attempts.get(key);
    if (!item || item.resets < now) {
      attempts.set(key, { count: 1, resets: now + 60000 });
      next();
      return;
    }
    if (++item.count > 10) {
      next(
        new ApiError(429, "RATE_LIMITED", "Too many authentication attempts."),
      );
      return;
    }
    next();
  }

  app.post("/api/tokens/count", async (req, res) => {
    // Public endpoint — no requireUser(req)

    const body = tokenCountBody.parse(req.body);
    const cfg = await configLoader();

    const history = body.history ?? [];

    // Match the message assembly used by the chat preview.
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: cfg.systemPrompt,
      },
      ...history,
      {
        role: "user",
        content: body.prompt,
      },
    ];

    // Count the prompt text alone.
    const promptTokens = await rawTokenCounter(body.prompt);

    // Count the assembled request, including the
    // system prompt, history and chat-template markers.
    const inputTokens = await tokenCounter(messages);

    // Reuse the existing application's budget policy.
    const decision = evaluateBudget({
      inputTokens,
      overheadTokens: cfg.budget.safetyMarginTokens,
      reservedOutputTokens: cfg.model.outputTokens,
      contextLimit: cfg.budget.policyLimitTokens,
    });

    res.json({
      model: cfg.model.name,

      tokenizer: "qwen2.5",

      accountingMethod: "chat-template-estimate",

      promptTokens,

      estimatedInputTokens: inputTokens,

      otherContextAndTemplateTokens: inputTokens - promptTokens,

      historyMessageCount: history.length,

      budget: decision,
    });
  });

  app.post("/api/auth/register", limitAuth, async (req, res) => {
    const body = credentials.parse(req.body);
    try {
      const user = await createAccount(deps.store, body.email, body.password);
      await startSession(deps.store, user.id, res);
      res.status(201).json({ user });
    } catch (e) {
      if (e instanceof Error && e.message === "EMAIL_TAKEN")
        throw new ApiError(
          409,
          "EMAIL_TAKEN",
          "An account with this email already exists.",
        );
      throw e;
    }
  });
  app.post("/api/auth/login", limitAuth, async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const user = await verifyCredentials(deps.store, email, password);
    if (!user)
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    await startSession(deps.store, user.id, res);
    res.json({ user });
  });
  app.post("/api/auth/logout", async (req, res) => {
    await endSession(deps.store, req, res);
    res.status(204).end();
  });
  app.get("/api/auth/me", async (req, res) => {
    res.json({ user: currentUser(deps.store, req) });
  });

  app.get("/api/chats", async (req, res) => {
    const { id: userId } = requireUser(req);
    const chats = deps.store.read((d) =>
      d.conversations
        .filter((c) => c.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
    res.json({ chats });
  });

  app.post("/api/chats", async (req, res) => {
    const { id: userId } = requireUser(req);
    const body = newConversation.parse(req.body);
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      userId,
      title: body.title ?? "New conversation",
      createdAt: now,
      updatedAt: now,
    };
    await deps.store.write((d) => {
      d.conversations.push(conversation);
    });
    res.status(201).json({ chat: conversation });
  });

  app.get("/api/chats/:id", async (req, res) => {
    const { id: userId } = requireUser(req);
    const id = req.params.id as string;
    const chat = getConversation(userId, id);
    const messages = deps.store.read((d) =>
      d.messages
        .filter((m) => m.conversationId === id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
    res.json({ chat, messages });
  });

  // Preview is read-only: allows QA to inspect a candidate request before sending it.
  app.post("/api/chats/:id/preview", async (req, res) => {
    const { id: userId } = requireUser(req);
    const chat = getConversation(userId, req.params.id as string);
    const body = messageBody.parse(req.body);
    const { decision, historyMessageCount } = await preview(
      await configLoader(),
      chat,
      body.content,
    );
    res.json({ budget: decision, historyMessageCount });
  });

  app.post("/api/chats/:id/messages", async (req, res) => {
    const { id: userId } = requireUser(req);
    const id = req.params.id as string;
    const body = messageBody.parse(req.body);
    const result = await queue.run(id, async () => {
      const chat = getConversation(userId, id);
      const cfg = await configLoader();
      const { messages, decision, historyMessageCount } = await preview(
        cfg,
        chat,
        body.content,
      );
      if (!decision.allowed) {
        console.warn("[budget:reject]", {
          chatId: id,
          projectedTotal: decision.projectedTotal,
          limit: decision.contextLimit,
        });
        throw new ApiError(
          413,
          "CONTEXT_LIMIT_EXCEEDED",
          "This request would exceed the configured token budget. No history was changed.",
          { budget: decision, historyMessageCount },
        );
      }

      // No changes are persisted before successful generation. Rejections never call Ollama.
      const invocation = recordOllamaInvocation();

      console.info("[model:request]", {
        chatId: id,
        model: cfg.model.name,
        invocationIndex: invocation.index,
        timestamp: invocation.timestamp,
        estimatedInput: decision.inputTokens,
      });

      const reply = await ollama(cfg, messages);
      const now = new Date().toISOString();
      const usage = {
        estimatedInputTokens: decision.inputTokens,
        actualInputTokens: reply.promptEvalCount,
        actualOutputTokens: reply.evalCount,
        doneReason: reply.doneReason,
        projectedTotal: decision.projectedTotal,
      };
      const userMessage = {
        id: randomUUID(),
        conversationId: id,
        role: "user" as const,
        content: body.content,
        createdAt: now,
      };
      const assistantMessage = {
        id: randomUUID(),
        conversationId: id,
        role: "assistant" as const,
        content: reply.text,
        createdAt: new Date(Date.now() + 1).toISOString(),
        usage,
      };
      await deps.store.write((d) => {
        d.messages.push(userMessage, assistantMessage);
        const stored = d.conversations.find(
          (c) => c.id === id && c.userId === userId,
        );
        if (!stored)
          throw new ApiError(
            404,
            "CHAT_NOT_FOUND",
            "Conversation disappeared before persistence.",
          );
        if (stored.title === "New conversation")
          stored.title = body.content.slice(0, 48);
        stored.updatedAt = now;
      });
      return {
        message: assistantMessage,
        budget: decision,
        historyMessageCount,
        usage,
      };
    });
    res.status(201).json(result);
  });

  // A browser API request must come from the configured Next.js origin. Both services
  // bind loopback only. Use a real reverse proxy and TLS before any external deployment.
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request data.",
            details: error.issues,
          },
        });
        return;
      }
      if (error instanceof ApiError) {
        res.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        });
        return;
      }
      console.error(
        "[api:error]",
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Server error; check API terminal for details.",
        },
      });
    },
  );

  app.get("/api/qa/ollama-invocations", async (req, res) => {
    requireUser(req);

    const cfg = await configLoader();

    if (!cfg.qa?.exposeOllamaInvocationMetrics) {
      throw new ApiError(
        404,
        "NOT_FOUND",
        "QA invocation metrics are disabled.",
      );
    }

    return res.status(200).json(getOllamaInvocationStats());
  });

  return app;
}
