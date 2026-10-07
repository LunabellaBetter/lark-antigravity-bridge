import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AntigravityAdapter } from '../../src/agent/antigravity/adapter.js';
import type { AgentEvent } from '../../src/agent/types.js';

interface FakeBinary {
  path: string;
  dir: string;
  recordPath: string;
}

describe('AntigravityAdapter process contract', () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanup.splice(0).map((dir) =>
        rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }),
      ),
    );
  });

  it('spawns agy in headless JSON mode and translates the result', async () => {
    const fake = await createFakeAgy();
    cleanup.push(fake.dir);

    const cwd = await realpath(fake.dir);

    const run = new AntigravityAdapter({
      binary: fake.path,
    }).run({
      runId: 'run-antigravity',
      prompt: 'hello from lark',
      cwd,
    });

    expect(await collect(run.events)).toEqual([
      {
        type: 'system',
        sessionId: 'conv-test',
      },
      {
        type: 'final_text',
        content: 'AGY_OK\n',
      },
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 5,
        reasoningOutputTokens: 10,
      },
      {
        type: 'done',
        terminationReason: 'normal',
      },
    ]);

    const record = await readRecord(fake.recordPath);

    expect(await realpath(record.cwd)).toBe(cwd);
    expect(record.argv[0]).toBe('-p');
    expect(record.argv[1]).toContain('lark-channel-bridge 运行约定');
    expect(record.argv[1]).toContain('__bridge_cb');
    expect(record.argv[1]).toContain('hello from lark');
    expect(record.argv.slice(2)).toEqual(['--output-format', 'json']);
  });

  it('inherits proxy environment from the bridge process', async () => {
    const oldHttpProxy = process.env.HTTP_PROXY;
    const oldHttpsProxy = process.env.HTTPS_PROXY;

    process.env.HTTP_PROXY = 'http://127.0.0.1:9999';
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9999';

    try {
      const fake = await createFakeAgy();
      cleanup.push(fake.dir);

      const run = new AntigravityAdapter({
        binary: fake.path,
      }).run({
        runId: 'run-proxy',
        prompt: 'proxy test',
        cwd: await realpath(fake.dir),
      });

      await collect(run.events);

      const record = await readRecord(fake.recordPath);

      expect(record.env.HTTP_PROXY).toBe('http://127.0.0.1:9999');
      expect(record.env.HTTPS_PROXY).toBe('http://127.0.0.1:9999');
    } finally {
      if (oldHttpProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = oldHttpProxy;

      if (oldHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = oldHttpsProxy;
    }
  });

  it('emits Antigravity conversation_id as system sessionId', async () => {
    const fake = await createFakeAgy();
    cleanup.push(fake.dir);

    const run = new AntigravityAdapter({
      binary: fake.path,
    }).run({
      runId: 'run-conversation-id',
      prompt: 'hello',
      cwd: await realpath(fake.dir),
    });

    const events = await collect(run.events);

    expect(events).toContainEqual({
      type: 'system',
      sessionId: 'conv-test',
    });
  });

  it('preserves Antigravity conversation_id before permission denial', async () => {
    const fake = await createFakeAgyPermissionDenied();
    cleanup.push(fake.dir);

    const run = new AntigravityAdapter({
      binary: fake.path,
      remoteControlLogDir: fake.dir,
    }).run({
      runId: 'run-permission-session',
      prompt: 'find a file',
      cwd: await realpath(fake.dir),
    });

    const events = await collect(run.events);

    expect(events).toContainEqual({
      type: 'system',
      sessionId: 'conv-permission-test',
    });

    expect(events).toContainEqual({
      type: 'error',
      message:
        'Antigravity 权限不足：需要 command 权限；当前为 headless 模式，无法弹窗确认。请打开 Antigravity Remote Control 查看对应会话；如需在 headless 模式自动执行，请为该命令配置 permissions.allow 后重试：https://antigravity.google.com',
      terminationReason: 'failed',
    });
  });

  it('includes the direct Remote Control conversation URL on permission denial', async () => {
    const fake = await createFakeAgyPermissionDenied();
    cleanup.push(fake.dir);

    const logDir = join(fake.dir, 'remote-control-log');
    await mkdir(logDir, { recursive: true });

    await writeFile(
      join(logDir, 'cli-current.log'),
      [
        '[remote-control-11111111-2222-4333-8444-555555555555-v2] Starting V2 remote control connection',
        '[remote-control-11111111-2222-4333-8444-555555555555-v2] Connection status: Connected',
      ].join('\\n'),
    );

    const run = new AntigravityAdapter({
      binary: fake.path,
      remoteControlLogDir: logDir,
    }).run({
      runId: 'run-permission-direct-url',
      prompt: 'find a file',
      cwd: await realpath(fake.dir),
    });

    expect(await collect(run.events)).toEqual([
      {
        type: 'system',
        sessionId: 'conv-permission-test',
      },
      {
        type: 'error',
        message:
          'Antigravity 权限不足：需要 command 权限；当前为 headless 模式，无法弹窗确认。请在 Antigravity Remote Control 中审批当前会话：https://antigravity.google.com/r/11111111-2222-4333-8444-555555555555-v2?p=c%2Fconv-permission-test',
        terminationReason: 'failed',
      },
    ]);
  });

  it('surfaces headless permission denial instead of completing normally', async () => {
    const fake = await createFakeAgyPermissionDenied();
    cleanup.push(fake.dir);

    const run = new AntigravityAdapter({
      binary: fake.path,
      remoteControlLogDir: fake.dir,
    }).run({
      runId: 'run-permission-denied',
      prompt: 'find a file',
      cwd: await realpath(fake.dir),
    });

    expect(await collect(run.events)).toEqual([
      {
        type: 'system',
        sessionId: 'conv-permission-test',
      },
      {
        type: 'error',
        message:
          'Antigravity 权限不足：需要 command 权限；当前为 headless 模式，无法弹窗确认。请打开 Antigravity Remote Control 查看对应会话；如需在 headless 模式自动执行，请为该命令配置 permissions.allow 后重试：https://antigravity.google.com',
        terminationReason: 'failed',
      },
    ]);
  });
});

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function createFakeAgy(): Promise<FakeBinary> {
  const dir = await mkdtemp(join(tmpdir(), 'antigravity-adapter-test-'));
  const path = join(dir, 'fake-agy.mjs');
  const recordPath = join(dir, 'argv.json');

  await writeFile(
    path,
    [
      '#!/usr/bin/env node',
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({`,
      '  argv: process.argv.slice(2),',
      '  cwd: process.cwd(),',
      '  env: {',
      '    HTTP_PROXY: process.env.HTTP_PROXY,',
      '    HTTPS_PROXY: process.env.HTTPS_PROXY,',
      '  },',
      '}));',
      'console.log(JSON.stringify({',
      '  conversation_id: "conv-test",',
      '  status: "SUCCESS",',
      '  response: "AGY_OK\\n",',
      '  duration_seconds: 1.2,',
      '  num_turns: 1,',
      '  usage: {',
      '    input_tokens: 100,',
      '    output_tokens: 20,',
      '    thinking_tokens: 10,',
      '    cache_read_tokens: 5,',
      '    total_tokens: 120,',
      '  },',
      '}));',
    ].join('\n'),
    'utf8',
  );

  await chmod(path, 0o755);

  return {
    path,
    dir,
    recordPath,
  };
}

async function createFakeAgyPermissionDenied(): Promise<FakeBinary> {
  const dir = await mkdtemp(join(tmpdir(), 'antigravity-permission-test-'));
  const path = join(dir, 'fake-agy-permission.mjs');
  const recordPath = join(dir, 'argv.json');

  await writeFile(
    path,
    [
      '#!/usr/bin/env node',
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({`,
      '  argv: process.argv.slice(2),',
      '  cwd: process.cwd(),',
      '  env: {},',
      '}));',
      'process.stderr.write(' +
        JSON.stringify(
          'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.\n',
        ) +
        ');',
      'console.log(JSON.stringify({',
      '  conversation_id: "conv-permission-test",',
      '  status: "SUCCESS",',
      '  response: "",',
      '}));',
    ].join('\n'),
    'utf8',
  );

  await chmod(path, 0o755);

  return {
    path,
    dir,
    recordPath,
  };
}

async function readRecord(path: string): Promise<{
  argv: string[];
  cwd: string;
  env: {
    HTTP_PROXY?: string;
    HTTPS_PROXY?: string;
  };
}> {
  return JSON.parse(await readFile(path, 'utf8')) as {
    argv: string[];
    cwd: string;
    env: {
      HTTP_PROXY?: string;
      HTTPS_PROXY?: string;
    };
  };
}
