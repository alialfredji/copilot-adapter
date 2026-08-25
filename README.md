# Copilot Adapter

`@alialf/copilot-adapter` is a local GitHub Copilot Business adapter for
**Codex** and **Claude Code**. It translates Codex's Responses API and Claude's
Messages API into official `@github/copilot-sdk` sessions.

Start with [docs/GETTING-STARTED-CLIENTS.md](docs/GETTING-STARTED-CLIENTS.md) for
step-by-step client setup. See [docs/COMMANDS.md](docs/COMMANDS.md) for the
complete command reference. Maintainers should follow
[docs/PUBLISHING.md](docs/PUBLISHING.md) for npm releases.

This is a reviewable MVP. It binds only to `127.0.0.1`, requires a local bearer token, runs the Copilot SDK in `mode: "empty"`, and defaults to read-only workspace tools.

## Prerequisites

- Node.js 22.12+
- GitHub Copilot CLI with the organization's CLI policy enabled
- A Copilot Business/Enterprise seat
- Auth through `gh auth login`, `GH_TOKEN`, `GITHUB_TOKEN`, or a fine-grained `github_pat_` with **Copilot Requests**

Classic `ghp_` tokens are not supported by the Copilot SDK. `copilot login` alone may use keychain storage that SDK empty mode cannot read; `gh auth login` is the most reliable local setup.

## Install

```bash
npm install --global @alialf/copilot-adapter
copilot-adapter doctor
```

The legacy `copilot-harness` command remains available as an alias.

The adapter creates a 0600 local credential at `~/.copilot-harness/token`. It is not a GitHub token and only authenticates requests to localhost.

## Start and inspect

From the repository the model may access:

```bash
copilot-adapter start --cwd "$PWD" --port 4141 --policy read-only
```

In another terminal:

```bash
copilot-adapter status --models
```

The adapter never silently substitutes a nearby model. Setup does not pin a model unless you explicitly pass `--default-model`.

`copilot-adapter token --rotate` is picked up live by the adapter and helper-based clients. Rerun VS Code setup and replace Claude Desktop's static API key afterward.

Policies:

- `chat`: no workspace tools
- `read-only`: `view`, `glob`, and `grep` — default
- `workspace-write`: adds `edit` and `create`; no shell
- `unsafe-shell`: adds `bash`; explicit opt-in because the Copilot SDK owns execution
- `unsafe-all`: also enables configured MCP servers; grants their external capabilities

## Codex CLI

```bash
copilot-adapter setup codex --scope profile
codex --profile copilot
```

Setup syncs the Copilot seat into `~/.copilot-harness/codex-models.json` and writes `~/.codex/copilot.config.toml`. Inside Codex, use `/model` to switch models and `/reasoning` to change effort. Neither requires restarting the adapter.

After an organization model-policy change, refresh the picker with `copilot-adapter models sync`, then restart Codex because Codex loads catalogs at startup. To undo setup:

```bash
copilot-adapter setup codex --scope profile --remove
```

## Codex Desktop

```bash
copilot-adapter setup codex --scope global
```

Restart Codex Desktop, select a **local** task, and open the same folder passed to `--cwd`. Use the model picker for any catalog model and its advertised effort levels. The same global setup is used by the Codex VS Code extension; reload VS Code after setup.

Undo:

```bash
copilot-adapter setup codex --scope global --remove
```

Codex cloud tasks cannot reach a localhost adapter.

## Claude Code CLI

Claude Code deliberately accepts only discovered IDs containing `claude` or `anthropic`; GPT and Gemini models remain available in Codex but cannot be exposed honestly in Claude Code.

```bash
copilot-adapter setup claude-cli
claude
```

Verify `/status` shows `http://127.0.0.1:4141`. Setup disables competing Foundry, Bedrock, and Vertex routing flags. Use `/model` to switch Claude models and `/effort` (or left/right in the model picker) to change effort without restarting the adapter. The adapter rejects effort levels a selected Copilot model does not advertise.

Undo:

```bash
copilot-adapter setup claude-cli --remove
```

## Claude Code for VS Code

```bash
copilot-adapter setup claude-vscode
```

Reload the VS Code window, then use `/model` and `/effort`. The installer preserves JSONC comments and unrelated environment variables.

Undo:

```bash
copilot-adapter setup claude-vscode --remove
```

Setup stores the exact original file beside the managed configuration as
`*.copilot-harness.backup`; a small `*.copilot-harness.backup.meta.json` sidecar
preserves whether the file existed and its permissions. `--remove` always
restores that snapshot, even if the managed file changed afterward. Legacy
base64 backups remain restorable.

## Claude Desktop Code tab

```bash
copilot-adapter setup claude-desktop
copilot-adapter token
```

Then configure:

1. Help → Troubleshooting → Enable Developer Mode.
2. Developer → Configure Third-Party Inference.
3. Provider: `Gateway`.
4. Base URL: `http://127.0.0.1:4141` — no `/v1`.
5. Credential kind: `Static API key`.
6. Auth scheme: `Bearer`.
7. API key: output from `copilot-adapter token`.

Use the Code tab's model control for discovered Claude-family models. Gateway Code sessions are local-only; SSH, Remote Control, and cloud execution are unavailable.

## Verify the adapter itself

For source development:

```bash
npm ci
npm run check
npm run build
```

The deterministic suite covers both protocol translators, dynamic model/effort switching, Codex catalog generation, authentication, safe policy presets, path and symlink escapes, streaming events, client config merging, and exact rollback. The former upstream localhost-BYOK runtime tests are excluded because SDK 1.0.8 blocks their insecure mock transport; perform the live smoke test below instead.

## Live smoke test

Use a disposable repository and `read-only` first:

```bash
mkdir /tmp/copilot-harness-smoke
cd /tmp/copilot-harness-smoke
git init
printf 'export const answer = 42;\n' > answer.ts
copilot-adapter start --cwd "$PWD" --policy read-only
```

From another terminal, run `copilot-adapter status --models`, configure one client, and ask it to read `answer.ts` and report the exported value. Then restart with `--policy workspace-write` and ask it to create `result.txt`. Confirm it cannot run shell commands unless restarted with `--policy unsafe-shell`.

Finally, confirm the requests are attributed to the expected Copilot Business user in the organization's usage reporting.

## Security and limitations

- Only localhost is supported; never expose this process with a tunnel.
- The adapter process is fixed to one workspace. Use another port/process for a concurrent project.
- Codex and Claude permission dialogs do not control tools executed inside the Copilot SDK.
- Path-like tool arguments are checked against the canonical workspace and symlink escapes are rejected.
- Tool arguments, prompts, source, GitHub tokens, and adapter tokens are not logged.
- `unsafe-shell` is intentionally not treated as a hardened sandbox.
- A hosted gateway requires separate per-user identity, tenant isolation, repository execution, licensing, and audit design.

## Upstream and license

The protocol translation layer is based on the MIT-licensed [`copilot-sdk-proxy`](https://github.com/theblixguy/copilot-sdk-proxy). See [LICENSE](./LICENSE). This fork replaces permissive defaults with local authentication, SDK empty mode, explicit policies, reversible client setup, and updated Copilot SDK support.
