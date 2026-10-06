import type { Readable } from 'node:stream';
import { log } from '../../core/logger';
import {
  mergeProcessEnv,
  spawnProcess,
  type SpawnedProcessByStdio,
} from '../../platform/spawn';
import { SpawnFailed } from '../../runtime/errors';
import { prefixBridgeSystemPrompt } from '../bridge-system-prompt';
import { buildLarkChannelEnv, type LarkChannelEnvContext } from '../lark-channel-env';
import { checkAgentAvailability, type AgentAvailability } from '../preflight';
import type {
  AgentAdapter,
  AgentBotIdentity,
  AgentEvent,
  AgentRun,
  AgentRunOptions,
} from '../types';
import { translateAntigravityResult } from './json';

export interface AntigravityAdapterOptions {
  binary: string;
  stopGraceMs?: number;
  larkChannel?: LarkChannelEnvContext;
}

type AntigravityChild = SpawnedProcessByStdio<null, Readable, Readable>;

export class AntigravityAdapter implements AgentAdapter {
  readonly id = 'antigravity';
  readonly displayName = 'Antigravity CLI';

  private readonly binary: string;
  private readonly defaultStopGraceMs: number;
  private readonly larkChannel: LarkChannelEnvContext | undefined;
  private botIdentity: AgentBotIdentity | undefined;

  constructor(opts: AntigravityAdapterOptions) {
    this.binary = opts.binary;
    this.defaultStopGraceMs = opts.stopGraceMs ?? 5000;
    this.larkChannel = opts.larkChannel;
  }

  setBotIdentity(identity: AgentBotIdentity): void {
    this.botIdentity = identity;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).ok;
  }

  async checkAvailability(): Promise<AgentAvailability> {
    return checkAgentAvailability({
      agentId: 'antigravity',
      agentName: 'Antigravity CLI',
      command: this.binary,
      binaryPath: this.binary,
    });
  }

  async prepareRun(): Promise<void> {
    const availability = await this.checkAvailability();
    if (!availability.ok) {
      throw new SpawnFailed(
        'antigravity binary check failed',
        availability.error,
        availability.diagnostic.code,
        availability.diagnostic,
      );
    }
  }

  run(opts: AgentRunOptions): AgentRun {
    if (!opts.cwd) {
      throw new Error('cwd is required for AntigravityAdapter.run');
    }

    const prompt = prefixBridgeSystemPrompt(opts.prompt, this.botIdentity);
    const args = ['-p', prompt, '--output-format', 'json'];

    const child = spawnProcess(this.binary, args, {
      cwd: opts.cwd,
      env: mergeProcessEnv(
        process.env,
        buildLarkChannelEnv(this.larkChannel),
      ),
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as AntigravityChild;

    log.info('agent', 'spawn', {
      agent: 'antigravity',
      pid: child.pid ?? null,
      cwd: opts.cwd,
      promptChars: opts.prompt.length,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let runtimeError: Error | null = null;
    let interrupted = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      const line = chunk.toString('utf8').trim();
      if (line) {
        log.warn('agent', 'stderr', {
          agent: 'antigravity',
          line: line.slice(0, 1000),
        });
      }
    });

    child.on('error', (err) => {
      runtimeError = err;
    });

    child.on('exit', (code, signal) => {
      log.info('agent', 'exit', {
        agent: 'antigravity',
        pid: child.pid ?? null,
        code,
        signal,
      });
    });

    const stopGraceMs = opts.stopGraceMs ?? this.defaultStopGraceMs;

    return {
      runId: opts.runId,

      events: createEventStream(
        child,
        stdoutChunks,
        stderrChunks,
        () => runtimeError,
        () => interrupted,
      ),

      async stop() {
        if (child.exitCode !== null || child.signalCode !== null) return;

        interrupted = true;

        log.info('agent', 'stop-sigterm', {
          agent: 'antigravity',
          pid: child.pid ?? null,
          graceMs: stopGraceMs,
        });

        child.kill('SIGTERM');

        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              log.warn('agent', 'stop-sigkill', {
                agent: 'antigravity',
                pid: child.pid ?? null,
                graceMs: stopGraceMs,
              });
              child.kill('SIGKILL');
            }
            resolve();
          }, stopGraceMs);

          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      },

      waitForExit(timeoutMs: number): Promise<boolean> {
        if (child.exitCode !== null || child.signalCode !== null) {
          return Promise.resolve(true);
        }

        return new Promise<boolean>((resolve) => {
          const onExit = (): void => {
            clearTimeout(timer);
            resolve(true);
          };

          const timer = setTimeout(() => {
            child.removeListener('exit', onExit);
            resolve(false);
          }, timeoutMs);

          child.once('exit', onExit);
        });
      },
    };
  }
}

async function* createEventStream(
  child: AntigravityChild,
  stdoutChunks: Buffer[],
  stderrChunks: Buffer[],
  getRuntimeError: () => Error | null,
  wasInterrupted: () => boolean,
): AsyncGenerator<AgentEvent> {
  if (!child.pid) {
    const err = getRuntimeError();
    yield {
      type: 'error',
      message: err
        ? `failed to spawn antigravity: ${err.message}`
        : 'spawn returned no pid',
      terminationReason: 'failed',
    };
    return;
  }

  const exitCode = await waitForExitCode(child);

  if (wasInterrupted()) {
    yield {
      type: 'done',
      terminationReason: 'interrupted',
    };
    return;
  }

  const runtimeError = getRuntimeError();
  if (runtimeError) {
    yield {
      type: 'error',
      message: `antigravity runtime error: ${runtimeError.message}`,
      terminationReason: 'failed',
    };
    return;
  }

  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

  const permissionMatch = stderr.match(
    /tool required the "([^"]+)" permission that headless mode cannot prompt for/i,
  );

  if (permissionMatch) {
    const permission = permissionMatch[1] ?? 'unknown';

    yield {
      type: 'error',
      message: `Antigravity 权限不足：需要 ${permission} 权限；当前为 headless 模式，无法弹窗确认。请打开 Antigravity Remote Control，在「Una Mac」中完成审批后重试：https://antigravity.google.com`,
      terminationReason: 'failed',
    };
    return;
  }

  if (exitCode !== 0 && exitCode !== null) {
    const detail = stderr ? `: ${stderr.slice(0, 500)}` : '';

    yield {
      type: 'error',
      message: `antigravity exited with code ${exitCode}${detail}`,
      terminationReason: 'failed',
    };
    return;
  }

  const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();

  if (!stdout) {
    yield {
      type: 'error',
      message: 'antigravity returned empty stdout',
      terminationReason: 'failed',
    };
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    yield {
      type: 'error',
      message: 'antigravity returned invalid JSON on stdout',
      terminationReason: 'failed',
    };
    return;
  }

  yield* translateAntigravityResult(parsed);
}

async function waitForExitCode(
  child: AntigravityChild,
): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode;
  }

  return new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
}
