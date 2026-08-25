# Command Reference

All commands assume the repository is:

```bash
cd /Users/alialfredji/dev/vibe-code/copilot-harness-adapter
```

After `npm link`, use `copilot-harness`. Without linking, replace it with
`node dist/cli.js` in every example.

## Install and authenticate

```bash
node --version                    # Requires Node.js 22.12+
gh auth status
gh auth login
npm install
npm run build
npm link
copilot-harness login             # Authenticate through GitHub CLI
copilot-harness doctor            # Check all local prerequisites
copilot-harness --version
copilot-harness --help
```

The GitHub organization must enable Copilot CLI and assign the user a Copilot
Business or Enterprise seat.

## Start the adapter

Run this from the repository the clients should access:

```bash
copilot-harness start --cwd "$PWD"
copilot-harness start --cwd "$PWD" --port 4141 --policy read-only
copilot-harness start --cwd "$PWD" --policy workspace-write
copilot-harness start --cwd "$PWD" --policy chat
copilot-harness start --cwd "$PWD" --policy unsafe-shell
copilot-harness start --cwd "$PWD" --policy unsafe-all
```

Additional start options:

```bash
copilot-harness start --provider openai
copilot-harness start --provider claude
copilot-harness start --provider codex
copilot-harness start --log-level debug
copilot-harness start --config /absolute/path/config.json5
copilot-harness start --idle-timeout 30
copilot-harness start --help
```

Policies:

- `chat`: no workspace tools
- `read-only`: view, glob, and grep; default
- `workspace-write`: adds edit and create
- `unsafe-shell`: adds shell execution
- `unsafe-all`: also enables configured MCP servers

Stop the foreground adapter with `Ctrl+C`.

## Inspect the running adapter

```bash
copilot-harness status
copilot-harness status --models
copilot-harness status --port 4141
```

## Local adapter token

```bash
copilot-harness token             # Print the localhost bearer token
copilot-harness token --rotate    # Replace it
```

The token authenticates localhost requests only; it is not a GitHub token.

## Model catalogs

```bash
copilot-harness models sync
copilot-harness models sync --output /absolute/path/models.json
copilot-harness models sync --help
```

Restart Codex after syncing because it loads the catalog at startup. The
adapter itself does not need restarting to switch models.

## Codex CLI profile

```bash
copilot-harness setup codex --scope profile
codex --profile copilot
```

Optional setup arguments:

```bash
copilot-harness setup codex --scope profile --port 4141
copilot-harness setup codex --scope profile --default-model MODEL_ID
copilot-harness setup codex --scope profile --catalog /absolute/path/models.json
copilot-harness setup codex --scope profile --binary /absolute/path/copilot-harness
```

Inside Codex:

```text
/model
/reasoning
```

Undo:

```bash
copilot-harness setup codex --scope profile --remove
```

The profile is `~/.codex/copilot.config.toml`. If it did not exist before
setup, removal deletes it.

## Codex Desktop and VS Code extension

```bash
copilot-harness setup codex --scope global
```

Restart Codex Desktop or reload VS Code, select a local task, and open the same
folder passed to `--cwd`. Codex cloud tasks cannot reach a localhost adapter.

Undo:

```bash
copilot-harness setup codex --scope global --remove
```

The global configuration is `~/.codex/config.toml`.

## Claude Code CLI

```bash
copilot-harness setup claude-cli
claude
```

Optional setup arguments:

```bash
copilot-harness setup claude-cli --port 4141
copilot-harness setup claude-cli --default-model MODEL_ID
copilot-harness setup claude-cli --binary /absolute/path/copilot-harness
```

Inside Claude Code:

```text
/status
/model
/effort
```

`/status` should show `http://127.0.0.1:4141`. Claude exposes only discovered
Claude/Anthropic-family models.

Undo:

```bash
copilot-harness setup claude-cli --remove
```

The configuration is `~/.claude/settings.json`.

## Claude Code VS Code extension

```bash
copilot-harness setup claude-vscode
copilot-harness setup claude-vscode --port 4141
copilot-harness setup claude-vscode --default-model MODEL_ID
```

Reload the VS Code window, then use `/model` and `/effort`.

Undo:

```bash
copilot-harness setup claude-vscode --remove
```

## Claude Desktop Code tab

```bash
copilot-harness setup claude-desktop
copilot-harness setup claude-desktop --port 4141
copilot-harness token
```

Configure Claude Desktop with the printed gateway fields:

1. Enable Developer Mode under Help → Troubleshooting.
2. Open Developer → Configure Third-Party Inference.
3. Select `Gateway`.
4. Use `http://127.0.0.1:4141` without `/v1`.
5. Select a static API key with the `Bearer` scheme.
6. Paste the output from `copilot-harness token`.

## Backup and rollback verification

For a configuration such as `~/.claude/settings.json`, setup creates:

```text
~/.claude/settings.json.copilot-harness.backup
~/.claude/settings.json.copilot-harness.backup.meta.json
```

The first is an exact, readable copy of the original file. The sidecar stores
only whether the original existed and its file mode. `--remove` restores the
snapshot even when the managed file changed, then consumes both backup files.

Verify rollback:

```bash
copilot-harness setup claude-cli
shasum -a 256 ~/.claude/settings.json.copilot-harness.backup
# Add a harmless blank line to ~/.claude/settings.json.
copilot-harness setup claude-cli --remove
shasum -a 256 ~/.claude/settings.json
```

The two hashes should match.

## Development and verification

```bash
npm run dev
npm run start
npm run build
npm run typecheck
npm run lint
npm run fmt
npm run fmt:check
npm test
npm run test:watch
```

Run the full release-style verification:

```bash
npm run fmt:check
npm run typecheck
npm run lint
npm test
npm run build
```

## Discover command-specific options

```bash
copilot-harness start --help
copilot-harness token --help
copilot-harness status --help
copilot-harness models --help
copilot-harness models sync --help
copilot-harness setup --help
copilot-harness setup codex --help
copilot-harness setup claude-cli --help
copilot-harness setup claude-vscode --help
copilot-harness setup claude-desktop --help
copilot-harness doctor --help
```
