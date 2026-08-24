# Copilot Harness Adapter

Local GitHub Copilot Business adapter for **Codex** and **Claude Code**. It translates Codex's Responses API and Claude's Messages API into official `@github/copilot-sdk` sessions.

This is a reviewable MVP. It binds only to `127.0.0.1`, requires a local bearer token, runs the Copilot SDK in `mode: "empty"`, and defaults to read-only workspace tools.

## Prerequisites

- Node.js 22.12+
- GitHub Copilot CLI with the organization's CLI policy enabled
- A Copilot Business/Enterprise seat
- Auth through `gh auth login`, `GH_TOKEN`, `GITHUB_TOKEN`, or a fine-grained `github_pat_` with **Copilot Requests**

Classic `ghp_` tokens are not supported by the Copilot SDK. `copilot login` alone may use keychain storage that SDK empty mode cannot read; `gh auth login` is the most reliable local setup.

## Install

```bash
npm install
npm run build
npm link
copilot-harness doctor
```

The adapter creates a 0600 local credential at `~/.copilot-harness/token`. It is not a GitHub token and only authenticates requests to localhost.

## Start and inspect

From the repository the model may access:

```bash
copilot-harness start --cwd "$PWD" --port 4141 --policy read-only
```

In another terminal:

```bash
copilot-harness status --models
```

Choose an exact returned model ID. The adapter never silently substitutes a nearby model.

`copilot-harness token --rotate` is picked up live by the adapter and helper-based clients. Rerun VS Code setup and replace Claude Desktop's static API key afterward.

Policies:

- `chat`: no workspace tools
- `read-only`: `view`, `glob`, and `grep` — default
- `workspace-write`: adds `edit` and `create`; no shell
- `unsafe-shell`: adds `bash`; explicit opt-in because the Copilot SDK owns execution
- `unsafe-all`: also enables configured MCP servers; grants their external capabilities

## Codex CLI

```bash
copilot-harness setup codex --scope profile --model <model-id>
codex --profile copilot
```

This writes `~/.codex/copilot.config.toml`. To undo it:

```bash
copilot-harness setup codex --scope profile --remove
```

## Codex Desktop

```bash
copilot-harness setup codex --scope global --model <model-id>
```

Restart Codex Desktop, select a **local** task, and open the same folder passed to `--cwd`. The setup command updates `~/.codex/config.toml` and creates an exact reversible backup.

Undo:

```bash
copilot-harness setup codex --scope global --remove
```

Codex cloud tasks cannot reach a localhost adapter.

## Claude Code CLI

Use an ID containing `claude` or `anthropic`; Claude's gateway discovery filters other IDs.

```bash
copilot-harness setup claude-cli --model <claude-model-id>
claude
```

Verify `/status` shows `http://127.0.0.1:4141`, then verify `/model`.

Undo:

```bash
copilot-harness setup claude-cli --remove
```

## Claude Code for VS Code

```bash
copilot-harness setup claude-vscode --model <claude-model-id>
```

Reload the VS Code window. The installer preserves JSONC comments and unrelated environment variables.

Undo:

```bash
copilot-harness setup claude-vscode --remove
```

## Claude Desktop Code tab

```bash
copilot-harness setup claude-desktop
copilot-harness token
```

Then configure:

1. Help → Troubleshooting → Enable Developer Mode.
2. Developer → Configure Third-Party Inference.
3. Provider: `Gateway`.
4. Base URL: `http://127.0.0.1:4141` — no `/v1`.
5. Credential kind: `Static API key`.
6. Auth scheme: `Bearer`.
7. API key: output from `copilot-harness token`.

Gateway Code sessions are local-only; SSH, Remote Control, and cloud execution are unavailable.

## Verify the adapter itself

```bash
npm run typecheck
npm test
npm run build
```

The deterministic suite covers both protocol translators, authentication, safe policy presets, path and symlink escapes, streaming events, client config merging, and exact rollback. The former upstream localhost-BYOK runtime tests are excluded because SDK 1.0.8 blocks their insecure mock transport; perform the live smoke test below instead.

## Live smoke test

Use a disposable repository and `read-only` first:

```bash
mkdir /tmp/copilot-harness-smoke
cd /tmp/copilot-harness-smoke
git init
printf 'export const answer = 42;\n' > answer.ts
copilot-harness start --cwd "$PWD" --policy read-only
```

From another terminal, run `copilot-harness status --models`, configure one client, and ask it to read `answer.ts` and report the exported value. Then restart with `--policy workspace-write` and ask it to create `result.txt`. Confirm it cannot run shell commands unless restarted with `--policy unsafe-shell`.

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
