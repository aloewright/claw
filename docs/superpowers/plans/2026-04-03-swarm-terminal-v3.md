# Swarm Terminal + V3 Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive WebSocket terminal to the admin UI so Claude Code/Codex/Gemini can complete OAuth flows and interactive prompts inside the sandbox, then apply V3 DDD patterns to the swarm module.

**Architecture:** A new `/api/admin/swarm/terminal` WebSocket endpoint starts a CLI tool as a sandbox process and relays stdin/stdout over WebSocket. The admin UI gets an xterm.js terminal component. OAuth tokens are persisted to R2. The swarm module is restructured following V3 DDD with domain entities, value objects, and a domain event bus.

**Tech Stack:** Cloudflare Sandbox `startProcess` + `getLogs`, WebSocket relay, xterm.js (frontend), Hono WebSocket routes, Vitest.

---

## File Structure

```
src/
├── swarm/
│   ├── terminal.ts               # NEW: WebSocket terminal relay for sandbox processes
│   ├── terminal.test.ts          # NEW: Terminal relay tests
│   ├── domain/                   # NEW: V3 DDD entities and value objects
│   │   ├── agent.entity.ts       # Agent entity with lifecycle
│   │   ├── agent-status.vo.ts    # Status value object
│   │   └── swarm-event.ts        # Domain events
│   ├── index.ts                  # UPDATE: export new modules
├── routes/
│   └── swarm.ts                  # UPDATE: add terminal WebSocket endpoint
├── client/
│   └── pages/
│       └── TerminalPage.tsx      # NEW: xterm.js terminal component
│       └── TerminalPage.css      # NEW: terminal styles
```

**Modified files:**
- `Dockerfile` — install `ttyd` or use built-in `script` for PTY
- `src/client/App.tsx` — add terminal route/tab
- `src/swarm/index.ts` — export new modules
- `package.json` — add xterm.js dependency

---

## Task 1: Terminal Process Relay (Backend)

**Files:**
- Create: `src/swarm/terminal.ts`
- Test: `src/swarm/terminal.test.ts`

The core idea: `sandbox.startProcess()` starts a CLI tool, we poll `getLogs()` for output and use `sandbox.exec()` to write to the process's stdin via a named pipe.

- [ ] **Step 1: Write the failing test**

```typescript
// src/swarm/terminal.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TerminalSession, buildTerminalCommand } from './terminal';

describe('buildTerminalCommand', () => {
  it('builds claude command for interactive use', () => {
    const cmd = buildTerminalCommand('claude', { workspace: '/root/clawd' });
    expect(cmd).toContain('claude');
    expect(cmd).toContain('cd /root/clawd');
  });

  it('builds codex command', () => {
    const cmd = buildTerminalCommand('codex', {});
    expect(cmd).toContain('codex');
  });

  it('builds a shell command for general use', () => {
    const cmd = buildTerminalCommand('shell', {});
    expect(cmd).toBe('bash');
  });
});

describe('TerminalSession', () => {
  it('starts a process and captures output', async () => {
    const mockProcess = {
      id: 'proc-1',
      status: 'running',
      getLogs: vi.fn().mockResolvedValue({ stdout: 'Hello from claude\n', stderr: '' }),
      kill: vi.fn(),
    };
    const mockSandbox = {
      startProcess: vi.fn().mockResolvedValue(mockProcess),
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };

    const session = new TerminalSession(mockSandbox as any);
    await session.start('claude', {});

    expect(mockSandbox.startProcess).toHaveBeenCalled();
    expect(session.isRunning()).toBe(true);

    const output = await session.readOutput();
    expect(output).toContain('Hello from claude');
  });

  it('stops the process on close', async () => {
    const mockProcess = {
      id: 'proc-1',
      status: 'running',
      getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      kill: vi.fn(),
    };
    const mockSandbox = {
      startProcess: vi.fn().mockResolvedValue(mockProcess),
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };

    const session = new TerminalSession(mockSandbox as any);
    await session.start('shell', {});
    await session.close();

    expect(mockProcess.kill).toHaveBeenCalled();
    expect(session.isRunning()).toBe(false);
  });

  it('writes input to process via exec', async () => {
    const mockProcess = {
      id: 'proc-1',
      status: 'running',
      getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      kill: vi.fn(),
    };
    const mockSandbox = {
      startProcess: vi.fn().mockResolvedValue(mockProcess),
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };

    const session = new TerminalSession(mockSandbox as any);
    await session.start('shell', {});
    await session.writeInput('ls -la\n');

    expect(mockSandbox.exec).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/terminal.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement terminal session**

```typescript
// src/swarm/terminal.ts
import type { Sandbox, Process } from '@cloudflare/sandbox';

interface TerminalOptions {
  workspace?: string;
  env?: Record<string, string>;
}

export function buildTerminalCommand(tool: string, options: TerminalOptions): string {
  const cdPrefix = options.workspace ? `cd ${options.workspace} && ` : '';

  switch (tool) {
    case 'claude':
      return `${cdPrefix}claude --dangerously-skip-permissions`;
    case 'codex':
      return `${cdPrefix}codex`;
    case 'gemini':
      return `${cdPrefix}gemini`;
    case 'shell':
      return 'bash';
    default:
      return `${cdPrefix}${tool}`;
  }
}

export class TerminalSession {
  private sandbox: Sandbox;
  private process: Process | null = null;
  private lastLogOffset = 0;
  private running = false;

  constructor(sandbox: Sandbox) {
    this.sandbox = sandbox;
  }

  async start(tool: string, options: TerminalOptions): Promise<void> {
    const command = buildTerminalCommand(tool, options);
    this.process = await this.sandbox.startProcess(command, {
      env: options.env,
    });
    this.running = true;
    this.lastLogOffset = 0;
  }

  async readOutput(): Promise<string> {
    if (!this.process) return '';
    const logs = await this.process.getLogs();
    const stdout = logs.stdout ?? '';
    const stderr = logs.stderr ?? '';
    const combined = stdout + (stderr ? `\x1b[31m${stderr}\x1b[0m` : '');

    // Return only new output since last read
    const newOutput = combined.substring(this.lastLogOffset);
    this.lastLogOffset = combined.length;
    return newOutput;
  }

  async writeInput(input: string): Promise<void> {
    if (!this.process) return;
    // Write to process stdin via a fifo or exec trick
    const escaped = input.replace(/'/g, "'\\''");
    await this.sandbox.exec(
      `echo '${escaped}' >> /tmp/.terminal-input-${this.process.id} 2>/dev/null || true`
    );
  }

  isRunning(): boolean {
    return this.running;
  }

  async close(): Promise<void> {
    if (this.process) {
      try {
        await this.process.kill();
      } catch {
        // process may already be dead
      }
    }
    this.running = false;
    this.process = null;
  }

  getProcessId(): string | null {
    return this.process?.id ?? null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/terminal.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/swarm/terminal.ts src/swarm/terminal.test.ts
git commit -m "feat(swarm): add terminal session for interactive CLI tools in sandbox"
```

---

## Task 2: WebSocket Terminal Endpoint

**Files:**
- Modify: `src/routes/swarm.ts` — add `/terminal` WebSocket endpoint
- Modify: `src/swarm/index.ts` — export TerminalSession

- [ ] **Step 1: Add terminal endpoint to swarm routes**

In `src/routes/swarm.ts`, add after the existing routes:

```typescript
import { TerminalSession } from '../swarm/terminal';

// Active terminal sessions (keyed by a session token)
const terminals = new Map<string, TerminalSession>();

// POST /spawn-terminal — Start a terminal session, returns session ID
swarm.post('/spawn-terminal', async (c) => {
  const sandbox = c.get('sandbox');
  const body = await c.req.json<{ tool?: string; workspace?: string }>();
  const tool = body.tool ?? 'claude';
  const sessionId = crypto.randomUUID();

  const session = new TerminalSession(sandbox);
  await session.start(tool, { workspace: body.workspace ?? '/root/clawd' });
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

  // Upgrade to WebSocket
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'WebSocket upgrade required' }, 426);
  }

  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  // Poll for output and send to client
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

  // Receive input from client
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
```

- [ ] **Step 2: Update swarm/index.ts exports**

Add to `src/swarm/index.ts`:
```typescript
export { TerminalSession, buildTerminalCommand } from './terminal';
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/swarm.ts src/swarm/index.ts
git commit -m "feat(swarm): add WebSocket terminal endpoint for interactive CLI sessions"
```

---

## Task 3: xterm.js Terminal Frontend

**Files:**
- Create: `src/client/pages/TerminalPage.tsx`
- Create: `src/client/pages/TerminalPage.css`
- Modify: `src/client/App.tsx` — add terminal tab
- Modify: `package.json` — add xterm dependency

- [ ] **Step 1: Add xterm.js dependency**

Run: `cd /Users/aloe/Development/claw-deploy && npm install xterm @xterm/addon-fit @xterm/addon-web-links`

- [ ] **Step 2: Create terminal page component**

```tsx
// src/client/pages/TerminalPage.tsx
import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';
import './TerminalPage.css';

interface TerminalPageProps {
  onBack: () => void;
}

export default function TerminalPage({ onBack }: TerminalPageProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [tool, setTool] = useState('claude');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const spawnTerminal = async () => {
    setConnecting(true);
    try {
      const token = new URLSearchParams(window.location.search).get('token') ?? '';
      const res = await fetch(`/api/admin/swarm/spawn-terminal?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, workspace: '/root/clawd' }),
      });
      const data = await res.json();
      if (data.sessionId) {
        setSessionId(data.sessionId);
        connectWebSocket(data.sessionId, token);
      }
    } catch (err) {
      console.error('Failed to spawn terminal:', err);
    } finally {
      setConnecting(false);
    }
  };

  const connectWebSocket = (sid: string, token: string) => {
    if (!termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#1a1a2e', foreground: '#e0e0e0', cursor: '#00d4ff' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(termRef.current);
    fitAddon.fit();
    termInstance.current = term;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/admin/swarm/terminal/${sid}?token=${token}`
    );
    wsRef.current = ws;

    ws.onopen = () => term.writeln('\x1b[32mConnected to sandbox terminal\x1b[0m\r\n');
    ws.onmessage = (event) => term.write(event.data);
    ws.onclose = () => term.writeln('\r\n\x1b[31mSession closed\x1b[0m');

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    window.addEventListener('resize', () => fitAddon.fit());
  };

  const killSession = async () => {
    if (sessionId) {
      const token = new URLSearchParams(window.location.search).get('token') ?? '';
      await fetch(`/api/admin/swarm/terminal/${sessionId}?token=${token}`, { method: 'DELETE' });
    }
    wsRef.current?.close();
    termInstance.current?.dispose();
    setSessionId(null);
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      termInstance.current?.dispose();
    };
  }, []);

  return (
    <div className="terminal-page">
      <div className="terminal-toolbar">
        <button onClick={onBack}>&larr; Back</button>
        {!sessionId ? (
          <>
            <select value={tool} onChange={(e) => setTool(e.target.value)}>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="gemini">Gemini</option>
              <option value="shell">Shell</option>
            </select>
            <button onClick={spawnTerminal} disabled={connecting}>
              {connecting ? 'Connecting...' : 'Launch Terminal'}
            </button>
          </>
        ) : (
          <button onClick={killSession} className="danger">Kill Session</button>
        )}
      </div>
      <div ref={termRef} className="terminal-container" />
    </div>
  );
}
```

- [ ] **Step 3: Create terminal styles**

```css
/* src/client/pages/TerminalPage.css */
.terminal-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 80px);
}

.terminal-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
  align-items: center;
}

.terminal-toolbar button {
  padding: 6px 12px;
  border: 1px solid #0f3460;
  background: #1a1a2e;
  color: #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.terminal-toolbar button:hover {
  background: #0f3460;
}

.terminal-toolbar button.danger {
  border-color: #e94560;
  color: #e94560;
}

.terminal-toolbar button.danger:hover {
  background: #e94560;
  color: white;
}

.terminal-toolbar select {
  padding: 6px 8px;
  border: 1px solid #0f3460;
  background: #1a1a2e;
  color: #e0e0e0;
  border-radius: 4px;
  font-size: 13px;
}

.terminal-container {
  flex: 1;
  padding: 4px;
  background: #1a1a2e;
}
```

- [ ] **Step 4: Add terminal tab to App.tsx**

Replace `src/client/App.tsx`:

```tsx
import { useState } from 'react';
import AdminPage from './pages/AdminPage';
import TerminalPage from './pages/TerminalPage';
import './App.css';

export default function App() {
  const [view, setView] = useState<'admin' | 'terminal'>('admin');

  return (
    <div className="app">
      <header className="app-header">
        <img src="/logo-small.png" alt="Moltworker" className="header-logo" />
        <h1>OpenClaw Admin</h1>
        <nav className="header-nav">
          <button
            className={view === 'admin' ? 'active' : ''}
            onClick={() => setView('admin')}
          >Devices</button>
          <button
            className={view === 'terminal' ? 'active' : ''}
            onClick={() => setView('terminal')}
          >Terminal</button>
        </nav>
      </header>
      <main className="app-main">
        {view === 'admin' && <AdminPage />}
        {view === 'terminal' && <TerminalPage onBack={() => setView('admin')} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/client/ package.json package-lock.json
git commit -m "feat(swarm): add xterm.js terminal UI for interactive CLI sessions"
```

---

## Task 4: OAuth Token Persistence

**Files:**
- Modify: `start-openclaw.sh` — restore OAuth tokens from R2 on startup
- Modify: `start-openclaw.sh` — include OAuth dirs in background sync

The OAuth tokens for Claude Code (`/root/.claude/`), Codex (`/root/.codex/`), and Gemini (`/root/.gemini/`) need to survive container restarts.

- [ ] **Step 1: Add OAuth restore to startup script**

In `start-openclaw.sh`, after the Tailscale restore block (before the `else` at the end of the R2 restore section), add:

```bash
    # Restore CLI OAuth tokens (Claude Code, Codex, Gemini)
    for CLI_DIR in .claude .codex .gemini; do
        REMOTE_CLI_COUNT=$(rclone ls "r2:${R2_BUCKET}/cli-auth/${CLI_DIR}/" $RCLONE_FLAGS 2>/dev/null | wc -l)
        if [ "$REMOTE_CLI_COUNT" -gt 0 ]; then
            echo "Restoring ${CLI_DIR} auth from R2..."
            mkdir -p "/root/${CLI_DIR}"
            rclone copy "r2:${R2_BUCKET}/cli-auth/${CLI_DIR}/" "/root/${CLI_DIR}/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: ${CLI_DIR} auth restore failed"
        fi
    done
```

- [ ] **Step 2: Add OAuth dirs to background sync change detection**

In the `find` block inside the sync loop, add:

```bash
                find /root/.claude -newer "$MARKER" -type f -printf 'oauth:%P\n' 2>/dev/null
                find /root/.codex -newer "$MARKER" -type f -printf 'oauth:%P\n' 2>/dev/null
                find /root/.gemini -newer "$MARKER" -type f -printf 'oauth:%P\n' 2>/dev/null
```

- [ ] **Step 3: Add OAuth dirs to sync upload section**

After the Tailscale sync block, add:

```bash
                for CLI_DIR in .claude .codex .gemini; do
                    if [ -d "/root/${CLI_DIR}" ]; then
                        rclone sync "/root/${CLI_DIR}/" "r2:${R2_BUCKET}/cli-auth/${CLI_DIR}/" \
                            $RCLONE_FLAGS --exclude='*.log' --exclude='*.tmp' 2>> "$LOGFILE"
                    fi
                done
```

- [ ] **Step 4: Add OAuth sync to syncToR2 in sync.ts**

In `src/gateway/sync.ts`, after the Tailscale sync block, add:

```typescript
  // Sync CLI OAuth tokens (non-fatal, preserves auth across restarts)
  for (const cliDir of ['.claude', '.codex', '.gemini']) {
    await sandbox.exec(
      `test -d /root/${cliDir} && rclone sync /root/${cliDir}/ ${remote(`cli-auth/${cliDir}/`)} ${RCLONE_FLAGS} --exclude='*.log' --exclude='*.tmp' || true`,
      { timeout: 120000 },
    );
  }
```

- [ ] **Step 5: Update sync tests for new steps**

Add mock entries in `src/gateway/sync.test.ts` for the 3 new OAuth sync calls (same pattern as the Tailscale mock — add `.mockResolvedValueOnce(createMockExecResult())` for each).

- [ ] **Step 6: Commit**

```bash
git add start-openclaw.sh src/gateway/sync.ts src/gateway/sync.test.ts
git commit -m "feat(swarm): persist CLI OAuth tokens to R2 across container restarts"
```

---

## Task 5: V3 DDD Domain Entities

**Files:**
- Create: `src/swarm/domain/agent.entity.ts`
- Create: `src/swarm/domain/agent-status.vo.ts`
- Create: `src/swarm/domain/swarm-event.ts`
- Test: `src/swarm/domain/agent.entity.test.ts`

Apply V3 core-implementation patterns (Entity, Value Object, Domain Event) to the swarm module.

- [ ] **Step 1: Write the failing test**

```typescript
// src/swarm/domain/agent.entity.test.ts
import { describe, it, expect } from 'vitest';
import { SwarmAgent } from './agent.entity';
import { AgentStatus } from './agent-status.vo';

describe('SwarmAgent', () => {
  it('creates with idle status', () => {
    const agent = SwarmAgent.create('coordinator', 'claude');
    expect(agent.status.isIdle()).toBe(true);
    expect(agent.definitionId).toBe('coordinator');
    expect(agent.primaryCli).toBe('claude');
  });

  it('transitions to working when assigned a task', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.assignTask('Build API');
    expect(agent.status.isWorking()).toBe(true);
    expect(agent.currentTask).toBe('Build API');
  });

  it('emits AgentTaskAssigned event', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.assignTask('Build API');
    const events = agent.getUncommittedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent.task.assigned');
  });

  it('completes task and returns to idle', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.assignTask('Build API');
    agent.completeTask('Done');
    expect(agent.status.isIdle()).toBe(true);
    expect(agent.currentTask).toBeUndefined();
  });

  it('tracks cost savings', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.recordCliExecution(0.003);
    agent.recordCliExecution(0.005);
    expect(agent.totalCostSaved).toBeCloseTo(0.008);
  });

  it('cannot assign task to failed agent', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.fail('Out of memory');
    expect(() => agent.assignTask('New task')).toThrow('Cannot assign task to failed agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/domain/agent.entity.test.ts`
Expected: FAIL

- [ ] **Step 3: Create AgentStatus value object**

```typescript
// src/swarm/domain/agent-status.vo.ts
type StatusType = 'idle' | 'working' | 'completed' | 'failed';

export class AgentStatus {
  private constructor(private readonly value: StatusType) {}

  static idle(): AgentStatus { return new AgentStatus('idle'); }
  static working(): AgentStatus { return new AgentStatus('working'); }
  static completed(): AgentStatus { return new AgentStatus('completed'); }
  static failed(): AgentStatus { return new AgentStatus('failed'); }

  isIdle(): boolean { return this.value === 'idle'; }
  isWorking(): boolean { return this.value === 'working'; }
  isCompleted(): boolean { return this.value === 'completed'; }
  isFailed(): boolean { return this.value === 'failed'; }

  toString(): string { return this.value; }

  equals(other: AgentStatus): boolean {
    return this.value === other.value;
  }
}
```

- [ ] **Step 4: Create domain events**

```typescript
// src/swarm/domain/swarm-event.ts
export interface SwarmDomainEvent {
  type: string;
  agentId: string;
  timestamp: number;
  payload: unknown;
}

export function agentTaskAssigned(agentId: string, task: string): SwarmDomainEvent {
  return { type: 'agent.task.assigned', agentId, timestamp: Date.now(), payload: { task } };
}

export function agentTaskCompleted(agentId: string, result: string): SwarmDomainEvent {
  return { type: 'agent.task.completed', agentId, timestamp: Date.now(), payload: { result } };
}

export function agentFailed(agentId: string, reason: string): SwarmDomainEvent {
  return { type: 'agent.failed', agentId, timestamp: Date.now(), payload: { reason } };
}
```

- [ ] **Step 5: Create SwarmAgent entity**

```typescript
// src/swarm/domain/agent.entity.ts
import { AgentStatus } from './agent-status.vo';
import { SwarmDomainEvent, agentTaskAssigned, agentTaskCompleted, agentFailed } from './swarm-event';

export class SwarmAgent {
  private _status: AgentStatus;
  private _currentTask?: string;
  private _totalCostSaved = 0;
  private _events: SwarmDomainEvent[] = [];

  private constructor(
    public readonly id: string,
    public readonly definitionId: string,
    public readonly primaryCli: string,
  ) {
    this._status = AgentStatus.idle();
  }

  static create(definitionId: string, primaryCli: string): SwarmAgent {
    const id = `${definitionId}-${Date.now()}`;
    return new SwarmAgent(id, definitionId, primaryCli);
  }

  get status(): AgentStatus { return this._status; }
  get currentTask(): string | undefined { return this._currentTask; }
  get totalCostSaved(): number { return this._totalCostSaved; }

  assignTask(task: string): void {
    if (this._status.isFailed()) {
      throw new Error('Cannot assign task to failed agent');
    }
    this._currentTask = task;
    this._status = AgentStatus.working();
    this._events.push(agentTaskAssigned(this.id, task));
  }

  completeTask(result: string): void {
    this._currentTask = undefined;
    this._status = AgentStatus.idle();
    this._events.push(agentTaskCompleted(this.id, result));
  }

  fail(reason: string): void {
    this._currentTask = undefined;
    this._status = AgentStatus.failed();
    this._events.push(agentFailed(this.id, reason));
  }

  recordCliExecution(costSaved: number): void {
    this._totalCostSaved += costSaved;
  }

  getUncommittedEvents(): SwarmDomainEvent[] {
    return [...this._events];
  }

  clearEvents(): void {
    this._events = [];
  }
}
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/domain/agent.entity.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Update swarm/index.ts**

Add to exports:
```typescript
export { SwarmAgent } from './domain/agent.entity';
export { AgentStatus } from './domain/agent-status.vo';
export type { SwarmDomainEvent } from './domain/swarm-event';
export { agentTaskAssigned, agentTaskCompleted, agentFailed } from './domain/swarm-event';
```

- [ ] **Step 8: Commit**

```bash
git add src/swarm/domain/ src/swarm/index.ts
git commit -m "feat(swarm): add V3 DDD domain entities — SwarmAgent, AgentStatus, domain events"
```

---

## Task 6: Full Test Suite + Verification

- [ ] **Step 1: Run all swarm tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/`
Expected: All pass

- [ ] **Step 2: Run full project tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run`
Expected: All pass

- [ ] **Step 3: Type check**

Run: `cd /Users/aloe/Development/claw-deploy && npx tsc --noEmit`
Expected: Only pre-existing errors

---

## Summary

| Task | What | V3 Pattern |
|------|------|------------|
| 1 | Terminal session backend | CLI-first execution |
| 2 | WebSocket terminal endpoint | Interactive sandbox access |
| 3 | xterm.js frontend | User-facing terminal for OAuth |
| 4 | OAuth token persistence | R2 state management |
| 5 | DDD domain entities | V3 core-implementation |
| 6 | Verification | All tests pass |

### Terminal Flow
```
Admin UI → [Launch Terminal] → POST /spawn-terminal → sandbox.startProcess('claude')
         ↓
xterm.js ← WebSocket ← poll getLogs() every 200ms
         ↓
User types → WebSocket → writeInput() → sandbox.exec(echo to fifo)
         ↓
Claude Code prompts for OAuth → user responds in terminal → token saved
         ↓
OAuth token synced to R2 → survives container restart
```
