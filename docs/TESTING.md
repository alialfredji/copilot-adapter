# Testing

## Automated checks

Install dependencies and run the full check from the repository root:

```bash
npm ci
npm run check
npm run build
```

`npm run check` verifies formatting, types, lint rules, and tests. The tests
cover request translation, streaming, model selection, authentication,
workspace policies, and reversible client setup.

## Live smoke test

A live test requires a Copilot Business or Enterprise seat and GitHub CLI
authentication.

Create a temporary project and start with read-only access:

```bash
mkdir /tmp/copilot-adapter-smoke
cd /tmp/copilot-adapter-smoke
git init
printf 'export const answer = 42;\n' > answer.ts
copilot-adapter start --cwd "$PWD" --policy read-only
```

In another terminal:

1. Run `copilot-adapter status --models`.
2. Connect one supported client.
3. Ask the client to read `answer.ts` and report its exported value.
4. Confirm that attempts to edit files or run shell commands are refused.

Restart the adapter with `--policy workspace-write` and confirm that the client
can create a file but still cannot run shell commands.
