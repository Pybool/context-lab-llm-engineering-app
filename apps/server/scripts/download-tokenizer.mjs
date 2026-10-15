import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const model = 'Qwen/Qwen2.5-1.5B-Instruct';
const dir = resolve(process.cwd(), 'data/tokenizer');
await mkdir(dir, { recursive: true });
for (const filename of ['tokenizer.json', 'tokenizer_config.json']) {
  const url = `https://huggingface.co/${model}/resolve/main/${filename}`;
  console.log(`Downloading ${filename} from ${model}...`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  JSON.parse(data.toString('utf8'));
  await writeFile(resolve(dir, filename), data);
  console.log(`Saved ${filename} (${data.length} bytes)`);
}
console.log('Tokenizer files ready: data/tokenizer');
