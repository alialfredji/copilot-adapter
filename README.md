# Copilot Adapter

Use GitHub Copilot models in Codex and Claude Code through a local adapter.
`@alialf/copilot-adapter` translates the APIs used by those clients into
official `@github/copilot-sdk` sessions.

The adapter runs only on your computer, binds to `127.0.0.1`, and limits each
process to the project you choose.

## Requirements

- Node.js 22.12 or newer
- A GitHub Copilot Business or Enterprise seat
- GitHub Copilot CLI enabled by your organization
- GitHub CLI authentication (`gh auth login`)
- Codex or Claude Code

## Quick start

Install the adapter and check your setup:

```bash
npm install --global @alialf/copilot-adapter
copilot-adapter doctor
```

Start it from the project you want your client to access:

```bash
cd /path/to/your/project
copilot-adapter start --cwd "$PWD" --policy read-only
```

Keep that terminal open. In another terminal, confirm that the adapter is
running and list the models available to your Copilot account:

```bash
copilot-adapter status --models
```

Then connect a client.

### Codex CLI

```bash
copilot-adapter setup codex --scope profile
codex --profile copilot
```

Use `/model` and `/reasoning` inside Codex to change the model and reasoning
level.

### Codex Desktop or VS Code

```bash
copilot-adapter setup codex --scope global
```

Restart Codex Desktop or reload VS Code, then open the same project used with
`--cwd`. Only local tasks can connect to the adapter.

### Claude Code CLI

```bash
copilot-adapter setup claude-cli
claude
```

Run `/status` to confirm the base URL is `http://127.0.0.1:4141`. Use `/model`
and `/effort` to change settings.

### Claude Code for VS Code

```bash
copilot-adapter setup claude-vscode
```

Reload VS Code, then open the same project used with `--cwd`.

For Claude Desktop and detailed setup instructions, see the
[client setup guide](docs/GETTING-STARTED-CLIENTS.md).

## Access policies

The policy controls which tools Copilot may use inside the selected project:

- `chat`: no project tools
- `read-only`: read, search, and list files (default)
- `workspace-write`: also create and edit files
- `unsafe-shell`: also run shell commands
- `unsafe-all`: also use configured MCP servers

Start with `read-only`. Use the `unsafe-*` policies only when you trust the
client and understand the additional access.

## Useful commands

```bash
copilot-adapter status --models   # Check the adapter and available models
copilot-adapter models sync       # Refresh Codex models after a policy change
copilot-adapter token             # Print the local client token
copilot-adapter token --rotate    # Replace the local client token
copilot-adapter --help            # Show all commands
```

Run a setup command with `--remove` to undo its changes, for example:

```bash
copilot-adapter setup codex --scope profile --remove
copilot-adapter setup claude-cli --remove
```

## Security and limitations

- The adapter accepts connections only from localhost. Do not expose it through
  a tunnel or public proxy.
- One adapter process serves one project. Use another port and process for a
  second project.
- The local bearer token protects the adapter; it is not a GitHub token.
- Codex and Claude permission dialogs do not control tools run by the Copilot
  SDK. The adapter policy does.
- `unsafe-shell` is not a hardened sandbox.

## Documentation

- [Client setup](docs/GETTING-STARTED-CLIENTS.md)
- [Command reference](docs/COMMANDS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Testing](docs/TESTING.md)
- [Publishing](docs/PUBLISHING.md)

## License

MIT. The protocol translation layer is based on the MIT-licensed
[`copilot-sdk-proxy`](https://github.com/theblixguy/copilot-sdk-proxy).
