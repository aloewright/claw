import type { SwarmAgentDefinition, ModelConfig, ValidationResult } from './types';

export type AgentInput = Partial<SwarmAgentDefinition> & { name: string; model: ModelConfig };

export function validateSwarmAgent(input: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  if (!input.name) errors.push('Missing required field: name');
  if (!input.model) errors.push('Missing required field: model');
  return { valid: errors.length === 0, errors };
}

export function buildAgentsConfig(agents: AgentInput[]): SwarmAgentDefinition[] {
  return agents.map((agent) => {
    const result = validateSwarmAgent(agent as unknown as Record<string, unknown>);
    if (!result.valid) {
      throw new Error(`Invalid agent "${agent.name ?? '?'}": ${result.errors.join(', ')}`);
    }
    return {
      ...agent,
      identity: agent.identity ?? { name: agent.name },
      sandbox: agent.sandbox ?? { mode: 'sandbox' as const, scope: 'agent' as const },
      subagents: agent.subagents ?? { allowAgents: [] },
    };
  });
}
