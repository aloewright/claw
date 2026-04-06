import type { CliConfig } from './types';

interface CliOutput {
  content: string;
  success: boolean;
  error?: string;
  durationMs?: number;
}

interface CostSavings {
  apiCostEstimate: number;
  cliCost: number;
  saved: number;
}

const API_COST_PER_INPUT_TOKEN = 3 / 1_000_000;
const API_COST_PER_OUTPUT_TOKEN = 15 / 1_000_000;
const CLI_TOOLS = new Set(['claude', 'codex', 'gemini']);

function shellEscapeArg(arg: string): string {
  // Wrap in single quotes and escape existing single quotes in a POSIX-safe way.
  // This avoids relying on fragile manual backslash-escaping with double quotes.
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function buildCliCommand(tool: string, prompt: string, config: Partial<CliConfig>): string {
  const escapedPrompt = shellEscapeArg(prompt);
  const escapedArgs = (config.args ?? []).map(shellEscapeArg).join(' ');
  const argsPart = escapedArgs ? `${escapedArgs} ` : '';
  return `${tool} ${argsPart}-p ${escapedPrompt}`;
}

export function parseCliOutput(stdout: string, stderr: string): CliOutput {
  const hasError = stderr && (
    stderr.toLowerCase().includes('error') ||
    stderr.toLowerCase().includes('failed') ||
    stderr.toLowerCase().includes('denied')
  );
  if (hasError && !stdout.trim()) {
    return { content: '', success: false, error: stderr.trim() };
  }
  return { content: stdout.trim(), success: true };
}

export function estimateCostSavings(tool: string, inputTokens: number, outputTokens: number): CostSavings {
  const apiCost = (inputTokens * API_COST_PER_INPUT_TOKEN) + (outputTokens * API_COST_PER_OUTPUT_TOKEN);
  if (CLI_TOOLS.has(tool)) {
    return { apiCostEstimate: apiCost, cliCost: 0, saved: apiCost };
  }
  return { apiCostEstimate: apiCost, cliCost: apiCost, saved: 0 };
}

export async function runCliInSandbox(
  sandbox: { exec: (cmd: string) => Promise<{ stdout?: string; stderr?: string }> },
  tool: string,
  prompt: string,
  config: Partial<CliConfig> = {},
): Promise<CliOutput> {
  const command = buildCliCommand(tool, prompt, config);
  const start = Date.now();
  try {
    const result = await sandbox.exec(command);
    const output = parseCliOutput(result.stdout ?? '', result.stderr ?? '');
    output.durationMs = Date.now() - start;
    return output;
  } catch (error) {
    return {
      content: '',
      success: false,
      error: error instanceof Error ? error.message : 'CLI execution failed',
      durationMs: Date.now() - start,
    };
  }
}

export async function resolveCliTool(
  sandbox: { exec: (cmd: string) => Promise<{ stdout?: string; stderr?: string }> },
  preferred: string,
  fallbacks: string[] = [],
): Promise<string | null> {
  const candidates = [preferred, ...fallbacks].filter((t) => CLI_TOOLS.has(t));
  for (const tool of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const check = await sandbox.exec(`which ${tool} 2>/dev/null && echo "OK"`);
      if (check.stdout?.includes('OK')) return tool;
    } catch { continue; }
  }
  return null;
}
