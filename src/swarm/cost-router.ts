import type { CliConfig, ModelConfig } from './types';
import { buildCliCommand, parseCliOutput, estimateCostSavings, resolveCliTool } from './cli-runner';

interface RouteRequest {
  prompt: string;
  model: ModelConfig;
  cli?: CliConfig;
  systemPrompt?: string;
}

interface RouteResult {
  content: string;
  source: 'cli' | 'gateway';
  tool?: string;
  costSaved: number;
  durationMs: number;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class CostAwareRouter {
  private sandbox: { exec: (cmd: string) => Promise<{ stdout?: string; stderr?: string }> };
  private savings = 0;

  constructor(sandbox: { exec: (cmd: string) => Promise<{ stdout?: string; stderr?: string }> }) {
    this.sandbox = sandbox;
  }

  async route(request: RouteRequest, gatewayFetch?: FetchFn): Promise<RouteResult> {
    const start = Date.now();

    // Step 1: Try CLI (free path)
    if (request.cli) {
      // Extract CLI tool names from model fallbacks (e.g., "gemini-cli" -> "gemini")
      const cliFallbacks = (request.model.fallbacks ?? [])
        .filter((f) => f.endsWith('-cli'))
        .map((f) => f.replace(/-cli$/, ''));
      const available = await resolveCliTool(this.sandbox, request.cli.tool, cliFallbacks);
      if (available) {
        const command = buildCliCommand(available, request.prompt, request.cli);
        try {
          const result = await this.sandbox.exec(command);
          const output = parseCliOutput(result.stdout ?? '', result.stderr ?? '');
          if (output.success && output.content) {
            const inputTokens = estimateTokens(request.prompt);
            const outputTokens = estimateTokens(output.content);
            const saved = estimateCostSavings(available, inputTokens, outputTokens);
            this.savings += saved.saved;
            return {
              content: output.content,
              source: 'cli',
              tool: available,
              costSaved: saved.saved,
              durationMs: Date.now() - start,
            };
          }
        } catch {
          // CLI failed — fall through to gateway
        }
      }
    }

    // Step 2: Fall back to AI Gateway (paid path)
    if (gatewayFetch) {
      const fallbackModel = request.model.fallbacks?.find((f) => f.startsWith('cf-ai-gw-'));
      if (fallbackModel) {
        // Parse fallback model string (e.g., "cf-ai-gw-anthropic/claude-sonnet-4-5")
        const afterPrefix = fallbackModel.replace('cf-ai-gw-', '');
        const slashIdx = afterPrefix.indexOf('/');
        const providerPart = slashIdx >= 0 ? afterPrefix.substring(0, slashIdx) : afterPrefix;
        const modelId = slashIdx >= 0 ? afterPrefix.substring(slashIdx + 1) : providerPart;

        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
        messages.push({ role: 'user', content: request.prompt });

        // Construct gateway URL with provider and model
        const gatewayUrl = `/${providerPart}`;
        const response = await gatewayFetch(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId, messages, max_tokens: 8192 }),
        });

        if (!response.ok) {
          let errorMsg = `${response.status} ${response.statusText}`;
          try {
            const errBody = await response.json() as { error?: { message?: string } };
            if (errBody.error?.message) errorMsg = errBody.error.message;
          } catch {
            // response wasn't JSON — use status text
          }
          throw new Error(`AI Gateway error (${providerPart}): ${errorMsg}`);
        }

        let body: { choices?: Array<{ message: { content: string } }> };
        try {
          body = await response.json() as typeof body;
        } catch {
          throw new Error(`AI Gateway returned invalid JSON (${providerPart})`);
        }
        const content = body.choices?.[0]?.message?.content ?? '';
        return { content, source: 'gateway' as const, costSaved: 0, durationMs: Date.now() - start };
      }
    }

    throw new Error('No CLI tool or gateway fallback available');
  }

  totalCostSaved(): number {
    return this.savings;
  }
}
