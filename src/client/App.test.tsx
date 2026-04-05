import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import App from './App';

// Stub heavy child pages so smoke tests stay fast and isolated
vi.mock('./pages/AdminPage', () => ({
  default: () => <div data-testid="admin-page">AdminPage</div>,
}));

vi.mock('./pages/TerminalPage', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="terminal-page">
      TerminalPage
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('./App.css', () => ({}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header with title "OpenClaw Admin"', () => {
    render(<App />);

    expect(screen.getByText('OpenClaw Admin')).toBeInTheDocument();
  });

  it('renders Devices and Terminal navigation buttons', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Devices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminal' })).toBeInTheDocument();
  });

  it('shows AdminPage by default', () => {
    render(<App />);

    expect(screen.getByTestId('admin-page')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-page')).not.toBeInTheDocument();
  });

  it('switches to TerminalPage when Terminal nav button is clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));

    expect(screen.getByTestId('terminal-page')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-page')).not.toBeInTheDocument();
  });

  it('returns to AdminPage when TerminalPage calls onBack', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByTestId('admin-page')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-page')).not.toBeInTheDocument();
  });

  it('Devices nav button has "active" class when on admin view', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Devices' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Terminal' })).not.toHaveClass('active');
  });

  it('Terminal nav button has "active" class when on terminal view', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));

    expect(screen.getByRole('button', { name: 'Terminal' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Devices' })).not.toHaveClass('active');
  });
});
