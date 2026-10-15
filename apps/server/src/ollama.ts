import type { ChatMessage } from './tokenizer.js';
import type { LabConfig } from './config.js';

export type OllamaReply = {
  text: string;
  promptEvalCount: number;
  evalCount: number;
  doneReason: string;
};

export async function askOllama(cfg: LabConfig, messages: ChatMessage[]): Promise<OllamaReply> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.model.timeoutMs);
  try {
    const response = await fetch(`${cfg.model.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model.name,
        messages,
        stream: false,
        options: {
          num_ctx: cfg.model.contextWindowTokens,
          num_predict: cfg.model.outputTokens,
          temperature: cfg.model.temperature,
        },
      }),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const json = await response.json() as Record<string, unknown>;
    const message = json.message as Record<string, unknown> | undefined;
    if (!message || typeof message.content !== 'string' || typeof json.prompt_eval_count !== 'number' || typeof json.eval_count !== 'number' || typeof json.done_reason !== 'string') {
      throw new Error('Unexpected Ollama response shape');
    }
    return { text: message.content, promptEvalCount: json.prompt_eval_count, evalCount: json.eval_count, doneReason: json.done_reason };
  } finally { clearTimeout(timeout); }
}
