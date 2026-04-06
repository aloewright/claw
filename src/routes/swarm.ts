import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { TerminalSession } from '../swarm/terminal';

const swarm = new Hono<AppEnv>();

// GET /status — Swarm overview
swarm.get('/status', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    // Read config file directly without ensuring gateway is running
    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    const config = JSON.parse(configResult.stdout?.trim() ?? '{}');
    const agents = config?.agents?.list ?? [];
    const providers = Object.keys(config?.models?.providers ?? {});

    const cliCheck = await sandbox.exec(
      'echo "claude:$(which claude 2>/dev/null || echo missing)"; ' +
      'echo "codex:$(which codex 2>/dev/null || echo missing)"; ' +
      'echo "gemini:$(which gemini 2>/dev/null || echo missing)"'
    );
    const cliStatus: Record<string, boolean> = {};
    for (const line of (cliCheck.stdout ?? '').split('\n')) {
      const [tool, path] = line.split(':');
      if (tool) cliStatus[tool] = !path?.includes('missing');
    }

    return c.json({
      swarmEnabled: agents.length > 0,
      costStrategy: 'cli-first',
      agents: agents.map((a: { name: string; model: { primary: string } }) => ({
        name: a.name,
        model: a.model?.primary,
      })),
      cliTools: cliStatus,
      gatewayProviders: providers,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown' }, 500);
  }
});

// GET /memory/stats — Memory usage
swarm.get('/memory/stats', async (c) => {
  const kv = c.env.SWARM_KV;
  if (!kv) return c.json({ error: 'SWARM_KV not configured' }, 503);

  try {
    let cursor: string | undefined;
    const allKeys: Array<{ name: string }> = [];
    do {
      // eslint-disable-next-line no-await-in-loop
      const result = await kv.list({ prefix: 'swarm:', cursor });
      allKeys.push(...result.keys);
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return c.json({
      totalEntries: allKeys.length,
      agents: [...new Set(allKeys.map((k) => k.name.split(':')[1]))],
    });
  } catch (error) {
    console.error('[swarm] KV list failed:', error);
    return c.json({ error: 'Failed to read swarm memory' }, 502);
  }
});

// Active terminal sessions
const terminals = new Map<string, TerminalSession>();

// POST /spawn-terminal — Start a terminal session
swarm.post('/spawn-terminal', async (c) => {
  const sandbox = c.get('sandbox');
  const body = await c.req.json<{ tool?: string; workspace?: string }>();
  const tool = body.tool ?? 'claude';
  const workspace = body.workspace ?? '/root/clawd';

  // H1: Validate tool against allowlist
  const allowedTools = ['claude', 'codex', 'gemini', 'shell'];
  if (!allowedTools.includes(tool)) {
    return c.json({ error: `Invalid tool: ${tool}. Allowed: ${allowedTools.join(', ')}` }, 400);
  }

  // L1: Validate workspace path
  if (!/^[a-zA-Z0-9/_.-]+$/.test(workspace)) {
    return c.json({ error: 'Invalid workspace path: contains disallowed characters' }, 400);
  }
  if (!workspace.startsWith('/root/')) {
    return c.json({ error: 'Invalid workspace path: must start with /root/' }, 400);
  }

  const sessionId = crypto.randomUUID();

  const session = new TerminalSession(sandbox);
  await session.start(tool, { workspace });
  terminals.set(sessionId, session);

  return c.json({ sessionId, tool, processId: session.getProcessId() });
});

// GET /terminal/:sessionId — WebSocket for terminal I/O
swarm.get('/terminal/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = terminals.get(sessionId);

  if (!session || !session.isRunning()) {
    return c.json({ error: 'Terminal session not found or not running' }, 404);
  }

  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'WebSocket upgrade required' }, 426);
  }

  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  const pollInterval = setInterval(async () => {
    try {
      const output = await session.readOutput();
      if (output && server.readyState === WebSocket.OPEN) {
        server.send(output);
      }
      if (!session.isRunning()) {
        clearInterval(pollInterval);
        server.close(1000, 'Process exited');
      }
    } catch {
      clearInterval(pollInterval);
    }
  }, 200);

  server.addEventListener('message', async (event) => {
    if (typeof event.data === 'string') {
      await session.writeInput(event.data);
    }
  });

  server.addEventListener('close', async () => {
    clearInterval(pollInterval);
    await session.close();
    terminals.delete(sessionId);
  });

  return new Response(null, { status: 101, webSocket: client });
});

// DELETE /terminal/:sessionId — Kill a terminal session
swarm.delete('/terminal/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = terminals.get(sessionId);
  if (session) {
    await session.close();
    terminals.delete(sessionId);
  }
  return c.json({ success: true });
});

// GET /terminals — List active terminal sessions
swarm.get('/terminals', (c) => {
  const active = Array.from(terminals.entries()).map(([id, session]) => ({
    sessionId: id,
    running: session.isRunning(),
    processId: session.getProcessId(),
  }));
  return c.json({ terminals: active });
});

export { swarm };
