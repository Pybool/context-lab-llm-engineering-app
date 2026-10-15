import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const configurationSchema = z
  .object({
    http: z
      .object({
        port: z.number().int().min(1).max(65535),
        allowedOrigin: z.string().url(),
      })
      .strict(),
    model: z
      .object({
        ollamaUrl: z.string().url(),
        name: z.string().min(1),
        contextWindowTokens: z.number().int().min(128),
        outputTokens: z.number().int().min(1),
        temperature: z.number().min(0).max(2),
        timeoutMs: z.number().int().min(1000).max(600000),
      })
      .strict(),
    budget: z
      .object({
        policyLimitTokens: z.number().int().min(64),
        safetyMarginTokens: z.number().int().min(0),
        overLimitAction: z.literal("reject"),
      })
      .strict(),
    systemPrompt: z.string().min(1),

    qa: z
      .object({
        exposeOllamaInvocationMetrics: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const tokenCountBody = z
  .object({
    prompt: z.string().min(1).max(50_000),

    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1).max(50_000),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export type LabConfig = z.infer<typeof configurationSchema>;
const path = resolve(process.cwd(), "config/lab.config.json");

export async function loadConfig(): Promise<LabConfig> {
  // Re-read on every new HTTP request: config edits don't require restarting the server.
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const cfg = configurationSchema.parse(raw);
  if (cfg.budget.policyLimitTokens > cfg.model.contextWindowTokens) {
    throw new Error(
      "budget.policyLimitTokens must not exceed model.contextWindowTokens",
    );
  }
  if (cfg.model.outputTokens >= cfg.budget.policyLimitTokens) {
    throw new Error(
      "model.outputTokens must be less than budget.policyLimitTokens",
    );
  }
  if (
    cfg.budget.safetyMarginTokens + cfg.model.outputTokens >=
    cfg.budget.policyLimitTokens
  ) {
    throw new Error(
      "Output reservation plus safety margin must fit within policy limit",
    );
  }
  return cfg;
}

export function publicConfig(cfg: LabConfig) {
  return {
    model: cfg.model.name,
    contextWindowTokens: cfg.model.contextWindowTokens,
    policyLimitTokens: cfg.budget.policyLimitTokens,
    reservedOutputTokens: cfg.model.outputTokens,
    safetyMarginTokens: cfg.budget.safetyMarginTokens,
    overLimitAction: cfg.budget.overLimitAction,
    temperature: cfg.model.temperature,
    systemPrompt: cfg.systemPrompt,
    accounting:
      "Qwen tokenizer + Qwen chat template approximation; verify against Ollama prompt_eval_count",
  };
}
