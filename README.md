# lark-antigravity-bridge

A Feishu / Lark bridge for local AI coding agents, with added support for **Google Antigravity CLI (`agy`)**.

This fork keeps the existing Claude Code / Codex workflow and adds Antigravity-specific support for mobile use, conversation tracking, headless permission handling, and Remote Control deep links.

> **Use your phone to run local AI agents on your computer through Feishu / Lark.**
>
> This fork adds Google Antigravity CLI support with conversation tracking, headless permission handling, and direct Remote Control links to the exact Antigravity conversation.

[中文 README](./README.zh.md)

## Highlights

- Forward Feishu / Lark messages to local Claude Code, Codex CLI, or Antigravity CLI.
- Run multiple agents as separate profiles / bots.
- Switch projects from chat with `/cd` and `/ws`.
- Preserve Antigravity `conversation_id` in bridge session state.
- Surface Antigravity headless permission failures instead of silently dropping the reply.
- Generate a Remote Control deep link to the exact Antigravity conversation.
- Use explicit Antigravity `permissions.allow` rules for trusted low-risk commands.
- Support local web-development verification workflows such as build, preview, smoke tests, and Playwright.

## Prerequisites

- Node.js **>= 20.12.0**
- A Feishu / Lark PersonalAgent app
- At least one local agent installed and authenticated:
  - Claude Code: `claude`
  - Codex CLI: `codex`
  - Google Antigravity CLI: `agy` (supported by this fork)

## Install / develop from this fork

```bash
git clone https://github.com/LunabellaBetter/lark-antigravity-bridge.git
cd lark-antigravity-bridge
pnpm install
pnpm build
```

Run locally:

```bash
node bin/lark-channel-bridge.mjs run
```

For Antigravity:

```bash
LARK_CHANNEL_ANTIGRAVITY_BIN=/path/to/agy \
node bin/lark-channel-bridge.mjs run --agent antigravity
```

## Multiple profiles and per-profile service

Background services are installed as a **per-profile service**. Each profile keeps its own app credentials, sessions, working-directory state, and logs.

```bash
lark-channel-bridge start --profile claude --agent claude
lark-channel-bridge start --profile codex --agent codex
lark-channel-bridge start --profile antigravity --agent antigravity
```

Platform mapping:

- macOS: launchd user agent
- Linux: systemd user service
- Windows: Task Scheduler, launched through a `.cmd` wrapper

Useful profile management commands:

```bash
lark-channel-bridge profile export <name>
lark-channel-bridge profile export <name> --include-secrets --yes
lark-channel-bridge profile remove <name>
lark-channel-bridge profile remove <name> --purge --yes
```

## Working directories

Each profile may define a default working directory through `workspaces.default`.

```json
{
  "workspaces": {
    "default": "/Users/yourname/path/to/project"
  }
}
```

## Feishu / Lark commands

| Command | Effect |
|---|---|
| `/status` | Show profile, agent, cwd, session and run state |
| `/cd <path>` | Switch working directory |
| `/ws list` | List saved workspaces |
| `/ws save <name>` | Save current cwd as a workspace |
| `/ws use <name>` | Switch to a saved workspace |
| `/new` | Start a new session |
| `/stop` | Stop the current run |
| `/help` | Show help |
| `/invite user @name` | Allow a user to use the bot |
| `/remove user @name` | Remove user access |
| `/invite group` | Allow the current group |
| `/remove group` | Remove the current group |
| `/invite all group` | Allow all groups the bot has joined |

## lark-cli identity policy

Each profile uses a **profile-local lark-cli directory** so personal authorization is isolated between profiles.

## Cloud-doc comments

Cloud-doc comments are document-scoped. Supported document comments can trigger the bot when it is mentioned, subject to the document's own permissions.

## Canonical permissions

Bridge access configuration uses canonical `permissions` fields:

```json
{
  "permissions": {
    "defaultAccess": "full",
    "maxAccess": "full"
  }
}
```

The legacy `sandbox` setting is still readable for compatibility, but new configuration should use `permissions`.

## Antigravity conversation tracking

Antigravity JSON output includes a `conversation_id`.

This fork maps it to a bridge `system.sessionId` event and persists it in the session store, so a Feishu / Lark run remains associated with the exact Antigravity conversation that produced it.

## Remote Control deep links

When a headless Antigravity tool call is denied, the bridge can discover the currently connected Remote Control instance and generate a direct URL:

```text
https://antigravity.google.com/r/<instance-id>?p=c%2F<conversation-id>
```

If the active instance cannot be resolved, the bridge falls back to the generic Antigravity Remote Control entry point.

### Headless permission limitation

Antigravity print / headless mode cannot pause and wait for an interactive permission prompt.

If a command is not covered by `permissions.allow`, the tool call can be auto-denied and the run can finish before any remote approval is possible.

Therefore the deep link is useful for opening the exact conversation, but it cannot retroactively approve a tool call that has already been denied.

Recommended model:

```text
trusted low-risk command
→ permissions.allow
→ execute normally in headless mode

command outside the allow list
→ Antigravity denies it
→ bridge returns the matching Remote Control conversation link
```

Avoid routine use of:

```text
--dangerously-skip-permissions
```

because it auto-approves all tool permission requests.

## Sanitized Antigravity settings example

See:

```text
examples/antigravity-settings.example.json
```

Typical public example:

```json
{
  "permissions": {
    "allow": [
      "command(pwd)",
      "command(ls)",
      "command(ls -la)",
      "command(find . -maxdepth 2 -type f -print)",
      "command(git status)",
      "command(git status --short)",
      "command(git branch --show-current)",
      "command(git diff --stat)",
      "command(git diff --name-only)",
      "command(git log -n 10 --oneline)",
      "command(node --version)",
      "command(npm --version)",
      "command(pnpm --version)",
      "command(python3 --version)",
      "command(pnpm typecheck)",
      "command(pnpm build)",
      "command(pnpm vitest run)",
      "command(npm run build)",
      "command(npm run verify)",
      "command(npx vite build)",
      "command(npx playwright test)"
    ]
  },
  "trustedWorkspaces": [
    "/Users/yourname/path/to/your-project"
  ]
}
```

Do not publish your real Antigravity settings file.

## Website-development workflow

```text
edit
→ build
→ start dev / preview
→ localhost health check
→ browser validation
→ DOM / Console / Network checks
→ Playwright / smoke test
→ fix
→ verify again
```

Prefer explicit allow rules for:

- build / typecheck
- local dev / preview
- localhost-only health checks
- smoke tests
- Playwright tests
- read-only Git inspection

Avoid broad automatic allow rules for:

- `rm`
- arbitrary `mv` / `cp`
- arbitrary external `curl`
- arbitrary package installation
- `env` / `printenv`
- unrestricted shell execution

## Remote Control daemon

```bash
agy remote-control start --name "My Mac"
```

## Testing and CI

Relevant Antigravity regression tests:

```bash
pnpm vitest run tests/process/antigravity-adapter.test.ts
pnpm vitest run tests/process/antigravity-remote-control.test.ts
pnpm vitest run tests/integration/bot/markdown-stream-startup-failure.test.ts
```

Full local checks:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Privacy and security

Never commit or publish:

- Feishu / Lark app secrets
- OAuth tokens
- `~/.lark-channel/config.json`
- Antigravity OAuth tokens
- Antigravity conversation databases
- real Remote Control instance IDs
- private daemon / bridge logs
- personal machine paths you do not want public
- HR, company, customer, or other confidential data

Use placeholders in public examples:

```text
/Users/yourname/path/to/project
<instance-id>
<conversation-id>
```

## Status of this fork

Implemented and regression-tested:

- Antigravity agent registration
- Antigravity JSON translation
- Antigravity profile/runtime integration
- `conversation_id` propagation
- session persistence
- headless permission-denial detection
- Feishu / Lark error surfacing
- Remote Control instance discovery
- Remote Control direct conversation URL generation
- sanitized permission example
- process and integration tests

## License

MIT
