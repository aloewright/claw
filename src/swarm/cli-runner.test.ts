import { describe, it, expect } from 'vitest';
import { buildCliCommand, parseCliOutput, estimateCostSavings } from './cli-runner';

describe('buildCliCommand', () => {
  it('builds claude command with prompt', () => {
    const cmd = buildCliCommand('claude', 'Write a function', { args: ['--dangerously-skip-permissions'] });
    expect(cmd).toBe("claude '--dangerously-skip-permissions' -p 'Write a function'");
  });

  it('builds codex command with prompt', () => {
    const cmd = buildCliCommand('codex', 'Fix the bug', { args: ['--quiet'] });
    expect(cmd).toBe("codex '--quiet' -p 'Fix the bug'");
  });

  it('builds gemini command with prompt', () => {
    const cmd = buildCliCommand('gemini', 'Analyze code', {});
    expect(cmd).toBe("gemini -p 'Analyze code'");
  });

  it('escapes quotes in prompt', () => {
    const cmd = buildCliCommand('claude', 'Say "hello"', {});
    expect(cmd).toBe("claude -p 'Say \"hello\"'");
  });
});

describe('parseCliOutput', () => {
  it('extracts content from stdout', () => {
    const result = parseCliOutput('Here is the code:\n```\nconst x = 1;\n```', '');
    expect(result.content).toContain('const x = 1');
    expect(result.success).toBe(true);
  });

  it('marks failure on stderr with error', () => {
    const result = parseCliOutput('', 'Error: authentication failed');
    expect(result.success).toBe(false);
    expect(result.error).toContain('authentication failed');
  });
});

describe('estimateCostSavings', () => {
  it('estimates savings for claude-cli vs API', () => {
    const savings = estimateCostSavings('claude', 1000, 500);
    expect(savings.apiCostEstimate).toBeGreaterThan(0);
    expect(savings.cliCost).toBe(0);
    expect(savings.saved).toBe(savings.apiCostEstimate);
  });

  it('returns zero savings for API fallback', () => {
    const savings = estimateCostSavings('cf-ai-gw-anthropic', 1000, 500);
    expect(savings.saved).toBe(0);
  });
});
