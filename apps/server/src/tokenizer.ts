import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';

export type ChatRole = 'system' | 'user' | 'assistant';
export type ChatMessage = { role: ChatRole; content: string };

let tokenizerPromise: Promise<Tokenizer> | undefined;

async function openTokenizer(): Promise<Tokenizer> {
  const dir = resolve(process.cwd(), 'data/tokenizer');
  try {
    const [json, config] = await Promise.all([
      readFile(resolve(dir, 'tokenizer.json'), 'utf8'),
      readFile(resolve(dir, 'tokenizer_config.json'), 'utf8'),
    ]);
    return new Tokenizer(JSON.parse(json), JSON.parse(config));
  } catch (error) {
    throw new Error(
      'Tokenizer unavailable. Run "npm run tokenizer:setup" once. ' +
      (error instanceof Error ? error.message : String(error)),
    );
  }
}

/**
 * Counts a simplified Qwen2.5 chat template. The Ollama template may differ;
 * this is an estimate, not a guaranteed provider-side input count.
 * No network calls or model inference happen during tokenization.
 */
export async function countChatTokens(messages: ChatMessage[]): Promise<number> {
  tokenizerPromise ??= openTokenizer().catch((error: unknown) => {
    tokenizerPromise = undefined;
    throw error;
  });
  const tokenizer = await tokenizerPromise;
  const serialized = messages
    .map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`)
    .join('') + '<|im_start|>assistant\n';
  return tokenizer.encode(serialized).ids.length;
}


export async function countTextTokens(
  text: string
): Promise<number> {
  tokenizerPromise ??= openTokenizer().catch(
    (error: unknown) => {
      tokenizerPromise = undefined;
      throw error;
    }
  );

  const tokenizer = await tokenizerPromise;

  return tokenizer.encode(text).ids.length;
}