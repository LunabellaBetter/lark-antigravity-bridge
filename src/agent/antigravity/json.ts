import type { AgentEvent } from '../types';

interface AntigravityUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

interface AntigravityResult {
  conversation_id?: string;
  status?: string;
  response?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: AntigravityUsage;
}

export function translateAntigravityResult(input: unknown): AgentEvent[] {
  if (!input || typeof input !== 'object') {
    return [
      {
        type: 'error',
        message: 'antigravity returned invalid JSON payload',
        terminationReason: 'failed',
      },
    ];
  }

  const result = input as AntigravityResult;

  if (result.status !== 'SUCCESS') {
    return [
      {
        type: 'error',
        message: `antigravity run failed${result.status ? `: ${result.status}` : ''}`,
        terminationReason: 'failed',
      },
    ];
  }

  const events: AgentEvent[] = [];

  if (typeof result.conversation_id === 'string' && result.conversation_id.length > 0) {
    events.push({
      type: 'system',
      sessionId: result.conversation_id,
    });
  }

  if (typeof result.response === 'string' && result.response.length > 0) {
    events.push({
      type: 'final_text',
      content: result.response,
    });
  }

  if (result.usage) {
    events.push({
      type: 'usage',
      ...(typeof result.usage.input_tokens === 'number'
        ? { inputTokens: result.usage.input_tokens }
        : {}),
      ...(typeof result.usage.output_tokens === 'number'
        ? { outputTokens: result.usage.output_tokens }
        : {}),
      ...(typeof result.usage.cache_read_tokens === 'number'
        ? { cachedInputTokens: result.usage.cache_read_tokens }
        : {}),
      ...(typeof result.usage.thinking_tokens === 'number'
        ? { reasoningOutputTokens: result.usage.thinking_tokens }
        : {}),
    });
  }

  events.push({
    type: 'done',
    terminationReason: 'normal',
  });

  return events;
}
