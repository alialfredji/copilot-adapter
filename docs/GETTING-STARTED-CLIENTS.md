# Client setup

Install and start the adapter once, then follow the section for the client you
use. You do not need to configure every client.

## Install and start

```bash
node --version
gh auth status
npm install --global @alialf/copilot-adapter
copilot-adapter doctor
```

Node.js 22.12 or newer is required. If GitHub CLI is not authenticated, run
`gh auth login`.

Start the adapter from the project you want the client to access:

```bash
cd /path/to/your/project
copilot-adapter start --cwd "$PWD" --policy read-only
```

Keep the adapter running. Use `--policy workspace-write` if the client should
be allowed to edit files. In another terminal, verify the connection:

```bash
copilot-adapter status --models
```

## Codex CLI

Configure and start Codex:

```bash
copilot-adapter setup codex --scope profile
codex --profile copilot
```

Use `/model` and `/reasoning` inside Codex. To remove the profile:

```bash
copilot-adapter setup codex --scope profile --remove
```

## Codex Desktop and VS Code

Codex Desktop and the Codex VS Code extension share the global configuration:

```bash
copilot-adapter setup codex --scope global
```

Restart Codex Desktop or reload VS Code. Open the same project passed to
`--cwd`, start a local task, and choose a model from the picker. Cloud tasks
cannot reach a localhost adapter.

To remove the configuration:

```bash
copilot-adapter setup codex --scope global --remove
```

Restart or reload the client afterward.

## Claude Code CLI

Configure and start Claude Code:

```bash
copilot-adapter setup claude-cli
claude
```

Run `/status` and confirm it shows `http://127.0.0.1:4141`. Use `/model` and
`/effort` to change settings. Only compatible Claude-family Copilot models are
shown.

To restore the previous Claude Code configuration:

```bash
copilot-adapter setup claude-cli --remove
```

## Claude Code for VS Code

```bash
copilot-adapter setup claude-vscode
```

Reload VS Code, open the same project passed to `--cwd`, and use `/status`,
`/model`, and `/effort` in the Claude Code extension.

To restore the previous extension configuration:

```bash
copilot-adapter setup claude-vscode --remove
```

Reload VS Code afterward.

## Claude Desktop Code tab

Claude Desktop requires manual gateway setup:

```bash
copilot-adapter setup claude-desktop
copilot-adapter token
```

Then:

1. Open **Help → Troubleshooting** and enable Developer Mode.
2. Open **Developer → Configure Third-Party Inference**.
3. Choose `Gateway`.
4. Set the base URL to `http://127.0.0.1:4141` without `/v1`.
5. Choose `Static API key` and the `Bearer` auth scheme.
6. Paste the output of `copilot-adapter token` as the API key.
7. Open the Code tab and select the same project passed to `--cwd`.

This applies to the Code tab, not regular Chat or Cowork. Remove the gateway
from Claude Desktop's Developer settings to undo the setup.

## Refresh available models

If your organization changes its Copilot model policy, run:

```bash
copilot-adapter models sync
```

Restart Codex or reload its VS Code extension afterward. The running adapter
does not need to be restarted.

## Stop the adapter

Press `Ctrl+C` in the terminal running `copilot-adapter start`.

See the [command reference](COMMANDS.md) for every option.
