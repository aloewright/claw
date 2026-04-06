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
  const resizeHandlerRef = useRef<(() => void) | null>(null);
  const [tool, setTool] = useState('claude');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const spawnTerminal = async () => {
    setConnecting(true);
    setSpawnError(null);
    try {
      const token = new URLSearchParams(window.location.search).get('token') ?? '';
      const res = await fetch(`/api/admin/swarm/spawn-terminal?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, workspace: '/root/clawd' }),
      });
      const data = (await res.json()) as { sessionId?: string; error?: string };
      if (!res.ok) {
        const msg = data.error ?? `Server error (HTTP ${res.status})`;
        console.error('Failed to spawn terminal:', res.status, msg);
        setSpawnError(msg);
        return;
      }
      if (data.sessionId) {
        setSessionId(data.sessionId);
        connectWebSocket(data.sessionId, token);
      }
    } catch (err) {
      console.error('Failed to spawn terminal:', err);
      setSpawnError(err instanceof Error ? err.message : 'Unknown error');
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
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#00d4ff',
        selectionBackground: '#e9456040',
      },
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

    ws.addEventListener('open', () => term.writeln('\x1b[32mConnected to sandbox terminal\x1b[0m\r\n'));
    ws.addEventListener('message', (event) => term.write(event.data));
    ws.addEventListener('close', () => term.writeln('\r\n\x1b[31mSession closed\x1b[0m'));
    ws.addEventListener('error', (err) => {
      term.writeln('\r\n\x1b[31mConnection error\x1b[0m');
      console.error('Terminal WebSocket error:', err);
      ws.close();
    });

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const handleResize = () => fitAddon.fit();
    resizeHandlerRef.current = handleResize;
    window.addEventListener('resize', handleResize);
  };

  const killSession = async () => {
    const doCleanup = () => {
      wsRef.current?.close();
      if (resizeHandlerRef.current) {
        window.removeEventListener('resize', resizeHandlerRef.current);
        resizeHandlerRef.current = null;
      }
      termInstance.current?.dispose();
      setSessionId(null);
    };

    if (sessionId) {
      const token = new URLSearchParams(window.location.search).get('token') ?? '';
      try {
        await fetch(`/api/admin/swarm/terminal/${sessionId}?token=${token}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to delete terminal session:', err);
      } finally {
        doCleanup();
      }
    } else {
      doCleanup();
    }
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (resizeHandlerRef.current) {
        window.removeEventListener('resize', resizeHandlerRef.current);
        resizeHandlerRef.current = null;
      }
      termInstance.current?.dispose();
    };
  }, []);

  return (
    <div className="terminal-page">
      <div className="terminal-toolbar">
        <button onClick={onBack}>&larr; Back</button>
        {!sessionId ? (
          <>
            <select aria-label="Tool" value={tool} onChange={(e) => setTool(e.target.value)}>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="gemini">Gemini</option>
              <option value="shell">Shell</option>
            </select>
            <button onClick={spawnTerminal} disabled={connecting}>
              {connecting ? 'Connecting...' : 'Launch Terminal'}
            </button>
            {spawnError && <span className="spawn-error">{spawnError}</span>}
          </>
        ) : (
          <button onClick={killSession} className="danger">Kill Session</button>
        )}
      </div>
      <div ref={termRef} className="terminal-container" />
    </div>
  );
}
