# Getting Started by Client

This guide covers every supported surface:

| Product | Terminal | Desktop | VS Code |
| --- | --- | --- | --- |
| Codex | Codex CLI | Codex Desktop | Codex extension |
| Claude | Claude Code CLI | Claude Desktop Code tab | Claude Code extension |

Choose the section you need. You do not need to configure every client.

## 1. One-time adapter installation

```bash
cd /Users/alialfredji/dev/vibe-code/copilot-harness-adapter

node --version          # Requires Node.js 22.12+
gh auth status          # Run `gh auth login` if needed
npm install
npm run build
npm link
copilot-harness doctor
```

Requirements:

- A Copilot Business or Enterprise seat
- Copilot CLI enabled by the GitHub organization
- Codex or Claude installed for the surface you want to use

Without `npm link`, replace `copilot-harness` with `node dist/cli.js` and run it
from the adapter repository.

## 2. Start the adapter for your project

Open a terminal in the project you want the client to access:

```bash
cd /path/to/your/project
copilot-harness start \
  --cwd "$PWD" \
  --port 4141 \
  --policy workspace-write
```

Keep this terminal running. In a second terminal, verify the connection and
available models:

```bash
copilot-harness status --models
```

Use `--policy read-only` instead if you do not want the adapter to edit files.

---

## Codex in the terminal

### Configure

```bash
copilot-harness setup codex --scope profile
```

### Start

From the same project passed to `--cwd`:

```bash
codex --profile copilot
```

### Verify and use

Inside Codex:

```text
/model
/reasoning
```

Select any model and reasoning level advertised by the Copilot model catalog,
then send a test prompt. Switching does not require restarting the adapter.

### Undo

```bash
copilot-harness setup codex --scope profile --remove
```

---

## Codex Desktop app

### Configure

```bash
copilot-harness setup codex --scope global
```

### Start

1. Fully restart Codex Desktop.
2. Create or open a **local** task.
3. Open the same project folder passed to the adapter with `--cwd`.
4. Open the model picker and select a Copilot catalog model.
5. Select an available reasoning level and send a test prompt.

The adapter must remain running. Cloud tasks cannot reach `127.0.0.1`.

### Undo

```bash
copilot-harness setup codex --scope global --remove
```

Restart Codex Desktop after removal.

---

## Codex in VS Code

### Configure

Codex Desktop and the Codex VS Code extension use the same global setup:

```bash
copilot-harness setup codex --scope global
```

### Start

1. Open the same project folder passed to `--cwd` in VS Code.
2. Reload the VS Code window.
3. Open the Codex extension.
4. Start a local task.
5. Use its model picker to select a Copilot catalog model and reasoning level.
6. Send a test prompt.

### Undo

```bash
copilot-harness setup codex --scope global --remove
```

Reload VS Code after removal.

---

## Claude Code in the terminal

### Configure

```bash
copilot-harness setup claude-cli
```

### Start

From the same project passed to `--cwd`:

```bash
claude
```

### Verify and use

Inside Claude Code:

```text
/status
/model
/effort
```

`/status` should show `http://127.0.0.1:4141`. Use `/model` and `/effort` to
switch without restarting the adapter. Claude surfaces only compatible
Claude/Anthropic-family Copilot models.

### Undo

```bash
copilot-harness setup claude-cli --remove
```

---

## Claude Desktop app

This works in Claude Desktop's **Code tab**, not regular Chat or Cowork.

### Print the connection values

```bash
copilot-harness setup claude-desktop
copilot-harness token
```

### Configure Claude Desktop

1. Open Help → Troubleshooting → Enable Developer Mode.
2. Open Developer → Configure Third-Party Inference.
3. Set Provider to `Gateway`.
4. Set Base URL to `http://127.0.0.1:4141` without `/v1`.
5. Set Credential kind to `Static API key`.
6. Set Auth scheme to `Bearer`.
7. Paste the output from `copilot-harness token` as the API key.
8. Open the **Code** tab.
9. Select the same project folder passed to `--cwd`.
10. Choose a discovered Claude-family model and send a test prompt.

The adapter must remain running. `setup claude-desktop` only prints values; it
does not edit Claude Desktop files.

### Undo

Remove or disable the Third-Party Inference gateway in Claude Desktop's
Developer settings.

---

## Claude Code in VS Code

### Configure

```bash
copilot-harness setup claude-vscode
```

### Start

1. Open the same project folder passed to `--cwd` in VS Code.
2. Reload the VS Code window.
3. Open the Claude Code extension.
4. Start a local session and run:

```text
/status
/model
/effort
```

5. Confirm `/status` shows `http://127.0.0.1:4141`.
6. Select a model and effort level, then send a test prompt.

### Undo

```bash
copilot-harness setup claude-vscode --remove
```

Reload VS Code after removal.

---

## Refresh models

After the GitHub organization changes its Copilot model policy:

```bash
copilot-harness models sync
```

Restart Codex or reload its VS Code extension afterward. Claude discovers its
compatible models through the running adapter.

## Backups

File-based setup commands preserve the exact original configuration beside the
managed file:

```text
<configuration>.copilot-harness.backup
<configuration>.copilot-harness.backup.meta.json
```

`--remove` restores the original even if the managed configuration changed.
Claude Desktop is configured manually in its UI, so it does not create these
backup files.

## Stop the adapter

Press `Ctrl+C` in the terminal running `copilot-harness start`.

For every available option and maintenance command, see [COMMANDS.md](COMMANDS.md).
