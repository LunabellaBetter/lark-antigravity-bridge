import { describe, expect, it } from 'vitest';
import { translateAntigravityResult } from '../../../../src/agent/antigravity/json';

describe('Antigravity JSON translator', () => {
  it('translates a successful agy JSON result', () => {
    expect(
      translateAntigravityResult({
        conversation_id: 'conv-123',
        status: 'SUCCESS',
        response: 'JSON_OK\n',
        duration_seconds: 3.15,
        num_turns: 1,
        usage: {
          input_tokens: 12820,
          output_tokens: 85,
          thinking_tokens: 82,
          cache_read_tokens: 7,
          total_tokens: 12905,
        },
      }),
    ).toEqual([
      {
        type: 'system',
        sessionId: 'conv-123',
      },
      {
        type: 'final_text',
        content: 'JSON_OK\n',
      },
      {
        type: 'usage',
        inputTokens: 12820,
        outputTokens: 85,
        cachedInputTokens: 7,
        reasoningOutputTokens: 82,
      },
      {
        type: 'done',
        terminationReason: 'normal',
      },
    ]);
  });

  it('returns an error event for a non-success status', () => {
    expect(
      translateAntigravityResult({
        status: 'ERROR',
      }),
    ).toEqual([
      {
        type: 'error',
        message: 'antigravity run failed: ERROR',
        terminationReason: 'failed',
      },
    ]);
  });

  it('returns an error event for an invalid payload', () => {
    expect(translateAntigravityResult(null)).toEqual([
      {
        type: 'error',
        message: 'antigravity returned invalid JSON payload',
        terminationReason: 'failed',
      },
    ]);
  });
});
