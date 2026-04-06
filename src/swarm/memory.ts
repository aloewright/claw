import type { MemoryEntry } from './types';

const PREFIX = 'swarm';
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

interface AIBinding {
  run: (model: string, input: unknown) => Promise<{ data: number[][] }>;
}

export class HybridMemory {
  private kv: KVNamespace;
  private ai: AIBinding;

  constructor(kv: KVNamespace, ai: AIBinding) {
    this.kv = kv;
    this.ai = ai;
  }

  private key(agentId: string, entryKey: string): string {
    return `${PREFIX}:${agentId}:${entryKey}`;
  }

  private async getPageEntries(names: string[]): Promise<(MemoryEntry | null)[]> {
    const raws = await Promise.all(names.map((name) => this.kv.get(name)));
    return raws.map((raw, i) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as MemoryEntry;
      } catch {
        console.warn(`[swarm-memory] Skipping corrupted entry: ${names[i]}`);
        return null;
      }
    });
  }

  async store(agentId: string, entryKey: string, value: string, withEmbedding = false): Promise<void> {
    const entry: MemoryEntry = { key: entryKey, value, agentId, timestamp: Date.now() };
    if (withEmbedding) {
      const result = await this.ai.run(EMBEDDING_MODEL, { text: [value] });
      entry.embedding = result.data[0];
    }
    await this.kv.put(this.key(agentId, entryKey), JSON.stringify(entry));
  }

  async get(agentId: string, entryKey: string): Promise<MemoryEntry | null> {
    const raw = await this.kv.get(this.key(agentId, entryKey));
    if (!raw) return null;
    return JSON.parse(raw) as MemoryEntry;
  }

  async list(agentId: string): Promise<MemoryEntry[]> {
    const prefix = `${PREFIX}:${agentId}:`;
    const entries: MemoryEntry[] = [];
    let cursor: string | undefined;

    do {
      // eslint-disable-next-line no-await-in-loop
      const result = await this.kv.list({ prefix, cursor });
      // eslint-disable-next-line no-await-in-loop
      const page = await this.getPageEntries(result.keys.map((k) => k.name));
      entries.push(...page.filter((e): e is MemoryEntry => e !== null));
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return entries;
  }

  async delete(agentId: string, entryKey: string): Promise<void> {
    await this.kv.delete(this.key(agentId, entryKey));
  }

  async search(query: string, agentId?: string): Promise<MemoryEntry[]> {
    const queryResult = await this.ai.run(EMBEDDING_MODEL, { text: [query] });
    const queryEmbedding = queryResult.data[0];
    const prefix = agentId ? `${PREFIX}:${agentId}:` : `${PREFIX}:`;
    const scored: Array<{ entry: MemoryEntry; score: number }> = [];
    let cursor: string | undefined;

    do {
      // eslint-disable-next-line no-await-in-loop
      const result = await this.kv.list({ prefix, cursor });
      // eslint-disable-next-line no-await-in-loop
      const page = await this.getPageEntries(result.keys.map((k) => k.name));
      for (const entry of page) {
        if (!entry?.embedding) continue;
        const score = cosineSimilarity(queryEmbedding, entry.embedding);
        scored.push({ entry, score });
      }
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return scored.toSorted((a, b) => b.score - a.score).slice(0, 10).map((s) => s.entry);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}
