import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import TerminalPage from './TerminalPage';

// xterm and its addons are not compatible with jsdom — stub them out
vi.mock('xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    writeln: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({})),
}));

// Stub CSS imports that jsdom cannot process
vi.mock('xterm/css/xterm.css', () => ({}));
vi.mock('./TerminalPage.css', () => ({}));

const mockOnBack = vi.fn();

describe('TerminalPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: fetch resolves successfully with a sessionId
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sessionId: 'test-session-123' }),
    });
    // Provide a minimal WebSocket stub
    global.WebSocket = vi.fn().mockImplementation(() => ({
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    })) as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the toolbar with "Launch Terminal" button when no session is active', () => {
    render(<TerminalPage onBack={mockOnBack} />);

    expect(screen.getByText('Launch Terminal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
  });

  it('"Launch Terminal" button is disabled while connecting (after click, before response)', async () => {
    // Never-resolving promise simulates in-flight request
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<TerminalPage onBack={mockOnBack} />);

    const launchBtn = screen.getByText('Launch Terminal');
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(screen.getByText('Connecting...')).toBeInTheDocument();
    });

    expect(screen.getByText('Connecting...')).toBeDisabled();
  });

  it('tool selector has aria-label "Tool"', () => {
    render(<TerminalPage onBack={mockOnBack} />);

    expect(screen.getByRole('combobox', { name: 'Tool' })).toBeInTheDocument();
  });

  it('renders all tool options: Claude Code, Codex, Gemini, Shell', () => {
    render(<TerminalPage onBack={mockOnBack} />);

    expect(screen.getByRole('option', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gemini' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Shell' })).toBeInTheDocument();
  });

  it('displays spawnError message when spawn fails (HTTP 500)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    render(<TerminalPage onBack={mockOnBack} />);

    fireEvent.click(screen.getByText('Launch Terminal'));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('clicking back button calls onBack prop', () => {
    render(<TerminalPage onBack={mockOnBack} />);

    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(mockOnBack).toHaveBeenCalledTimes(1);
  });

  it('"Kill Session" button is shown when sessionId is set after successful spawn', async () => {
    render(<TerminalPage onBack={mockOnBack} />);

    fireEvent.click(screen.getByText('Launch Terminal'));

    await waitFor(() => {
      expect(screen.getByText('Kill Session')).toBeInTheDocument();
    });

    expect(screen.queryByText('Launch Terminal')).not.toBeInTheDocument();
  });
});
