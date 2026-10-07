import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRemoteControlConversationUrl,
  findConnectedRemoteControlInstanceId,
  findRemoteControlConversationUrl,
} from '../../src/agent/antigravity/remote-control.js';

describe('Antigravity Remote Control instance discovery', () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanup.splice(0).map((dir) =>
        rm(dir, { recursive: true, force: true }),
      ),
    );
  });

  it('returns the latest connected remote-control instance that was not deleted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agy-remote-control-test-'));
    cleanup.push(root);

    const logDir = join(root, 'log');
    await mkdir(logDir, { recursive: true });

    await writeFile(
      join(logDir, 'cli-older.log'),
      [
        '[remote-control-old-instance-v2] Connection status: Connected',
        '[RemoteControl] Deleted session instance old-instance-v2',
      ].join('\n'),
    );

    await writeFile(
      join(logDir, 'cli-newer.log'),
      [
        '[remote-control-11111111-2222-4333-8444-555555555555-v2] Starting V2 remote control connection',
        '[remote-control-11111111-2222-4333-8444-555555555555-v2] Connection status: Connected',
      ].join('\n'),
    );

    expect(await findConnectedRemoteControlInstanceId(logDir)).toBe(
      '11111111-2222-4333-8444-555555555555-v2',
    );
  });
});

it('builds a direct Remote Control conversation URL', () => {
  expect(
    buildRemoteControlConversationUrl(
      '11111111-2222-4333-8444-555555555555-v2',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ),
  ).toBe(
    'https://antigravity.google.com/r/11111111-2222-4333-8444-555555555555-v2?p=c%2Faaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  );
});

it('resolves a direct conversation URL from Remote Control logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agy-remote-url-test-'));

  try {
    const logDir = join(root, 'log');
    await mkdir(logDir, { recursive: true });

    await writeFile(
      join(logDir, 'cli-current.log'),
      [
        '[remote-control-11111111-2222-4333-8444-555555555555-v2] Starting V2 remote control connection',
        '[remote-control-11111111-2222-4333-8444-555555555555-v2] Connection status: Connected',
      ].join('\n'),
    );

    expect(
      await findRemoteControlConversationUrl(
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        logDir,
      ),
    ).toBe(
      'https://antigravity.google.com/r/11111111-2222-4333-8444-555555555555-v2?p=c%2Faaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
