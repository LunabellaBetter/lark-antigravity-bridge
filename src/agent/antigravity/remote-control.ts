import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const REMOTE_CONTROL_ID =
  /remote-control-([0-9a-z-]+-v2)/i;

const CONNECTED =
  /\[remote-control-([0-9a-z-]+-v2)\].*Connection status:\s*Connected/i;

const DELETED =
  /\[RemoteControl\]\s+Deleted session instance\s+([0-9a-z-]+-v2)/i;

export async function findConnectedRemoteControlInstanceId(
  logDir: string,
): Promise<string | undefined> {
  const names = (await readdir(logDir))
    .filter((name) => /^cli-.*\.log$/i.test(name));

  const files = await Promise.all(
    names.map(async (name) => {
      const path = join(logDir, name);
      const info = await stat(path);
      return {
        path,
        mtimeMs: info.mtimeMs,
      };
    }),
  );

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const connected = new Set<string>();
  const deleted = new Set<string>();

  for (const file of files) {
    const text = await readFile(file.path, 'utf8');

    for (const line of text.split(/\r?\n/)) {
      const connectedMatch = line.match(CONNECTED);
      if (connectedMatch?.[1]) {
        connected.add(connectedMatch[1]);
        deleted.delete(connectedMatch[1]);
        continue;
      }

      const deletedMatch = line.match(DELETED);
      if (deletedMatch?.[1]) {
        deleted.add(deletedMatch[1]);
        connected.delete(deletedMatch[1]);
      }
    }
  }

  const ids = [...connected].filter((id) => !deleted.has(id));

  return ids.at(-1);
}

export function buildRemoteControlConversationUrl(
  instanceId: string,
  conversationId: string,
): string {
  return `https://antigravity.google.com/r/${instanceId}?p=${encodeURIComponent(
    `c/${conversationId}`,
  )}`;
}

export async function findRemoteControlConversationUrl(
  conversationId: string,
  logDir: string,
): Promise<string | undefined> {
  const instanceId = await findConnectedRemoteControlInstanceId(logDir);
  if (!instanceId) return undefined;

  return buildRemoteControlConversationUrl(instanceId, conversationId);
}

export function extractRemoteControlInstanceId(text: string): string | undefined {
  return text.match(REMOTE_CONTROL_ID)?.[1];
}
