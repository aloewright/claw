import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HybridMemory } from './memory';

function mockKV() {
  const store = new Map<string, string>();
  return {
    store, // exposed for direct manipulation in tests
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
      const allKeys = Array.from(store.keys()).filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      // Simulate pagination: 2 keys per page
      const PAGE_SIZE = 2;
      const startIdx = cursor ? parseInt(cursor, 10) : 0;
      const pageKeys = allKeys.slice(startIdx, startIdx + PAGE_SIZE);
      const nextIdx = startIdx + PAGE_SIZE;
      const list_complete = nextIdx >= allKeys.length;
      return {
        keys: pageKeys,
        list_complete,
        cursor: list_complete ? undefined : String(nextIdx),
      };
    }),
  };
}

function mockAI() {
  return { run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3, 0.4]] })) };
}

describe('HybridMemory', () => {
  let memory: HybridMemory;
  let kv: ReturnType<typeof mockKV>;
  let ai: ReturnType<typeof mockAI>;

  beforeEach(() => {
    kv = mockKV();
    ai = mockAI();
    memory = new HybridMemory(kv as unknown as KVNamespace, ai);
  });

  it('stores and retrieves by key (KV fast path)', async () => {
    await memory.store('agent-1', 'task-result', 'The API is built');
    const result = await memory.get('agent-1', 'task-result');
    expect(result?.value).toBe('The API is built');
    expect(kv.put).toHaveBeenCalled();
  });

  it('stores with embedding for semantic search', async () => {
    await memory.store('agent-1', 'context', 'Built REST API with auth', true);
    expect(ai.run).toHaveBeenCalled();
    const raw = await kv.get('swarm:agent-1:context');
    const parsed = JSON.parse(raw!);
    expect(parsed.embedding).toBeDefined();
  });

  it('lists all entries for an agent', async () => {
    await memory.store('agent-1', 'a', 'value-a');
    await memory.store('agent-1', 'b', 'value-b');
    const entries = await memory.list('agent-1');
    expect(entries).toHaveLength(2);
  });

  it('deletes an entry', async () => {
    await memory.store('agent-1', 'temp', 'data');
    await memory.delete('agent-1', 'temp');
    const result = await memory.get('agent-1', 'temp');
    expect(result).toBeNull();
  });

  it('paginates through all entries when list exceeds page size', async () => {
    await memory.store('agent-1', 'a', 'val-a');
    await memory.store('agent-1', 'b', 'val-b');
    await memory.store('agent-1', 'c', 'val-c');
    // Page size is 2, so this requires 2 pages
    const entries = await memory.list('agent-1');
    expect(entries).toHaveLength(3);
    const values = entries.map((e) => e.value).toSorted();
    expect(values).toEqual(['val-a', 'val-b', 'val-c']);
  });

  it('skips corrupted JSON entries without throwing', async () => {
    await memory.store('agent-1', 'good', 'valid data');
    // Inject corrupted JSON directly into the KV store
    kv.store.set('swarm:agent-1:bad', '{not valid json!!!');
    const entries = await memory.list('agent-1');
    // Should return only the valid entry, skip the corrupted one
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe('valid data');
  });

  it('search skips corrupted entries and returns valid results', async () => {
    await memory.store('agent-1', 'good', 'semantic data', true);
    kv.store.set('swarm:agent-1:corrupt', '{broken json');
    const results = await memory.search('semantic data', 'agent-1');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('semantic data');
  });
});
