import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

export type User = { id: string; email: string; salt: string; passwordHash: string; createdAt: string };
export type Session = { tokenHash: string; userId: string; expiresAt: number };
export type Conversation = { id: string; userId: string; title: string; createdAt: string; updatedAt: string };
export type SavedMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  usage?: { estimatedInputTokens: number; actualInputTokens: number; actualOutputTokens: number; doneReason: string; projectedTotal: number; };
};

export type Data = { users: User[]; sessions: Session[]; conversations: Conversation[]; messages: SavedMessage[] };
const empty = (): Data => ({ users: [], sessions: [], conversations: [], messages: [] });

/** Single-process local JSON persistence. Writes are serialized and atomic on one filesystem. */
export class JsonStore {
  private data = empty();
  private writes: Promise<unknown> = Promise.resolve();
  private constructor(private readonly filename: string) {}

  static async open(filename = resolve(process.cwd(), 'data/lab-db.json')) {
    const store = new JsonStore(filename);
    await mkdir(dirname(filename), { recursive: true });
    try { store.data = JSON.parse(await readFile(filename, 'utf8')) as Data; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return store;
  }

  read<T>(fn: (data: Readonly<Data>) => T): T {
    return fn(structuredClone(this.data));
  }

  async write<T>(fn: (data: Data) => T | Promise<T>): Promise<T> {
    const commit = async () => {
      const candidate = structuredClone(this.data);
      const result = await fn(candidate);
      const temp = `${this.filename}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(candidate, null, 2), { mode: 0o600 });
      await rename(temp, this.filename);
      this.data = candidate;
      return result;
    };
    const job = this.writes.then(commit, commit);
    this.writes = job.then(() => undefined, () => undefined);
    return job;
  }
}

/** Serializes requests per conversation to avoid stale concurrent history snapshots. */
export class KeyedQueue {
  private readonly pending = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.pending.set(key, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.pending.get(key) === current) this.pending.delete(key);
    }
  }
}
