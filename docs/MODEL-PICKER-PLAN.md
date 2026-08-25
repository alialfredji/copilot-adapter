# Native model picker implementation record

Status: implemented. This document is retained as the historical design record;
the README and client getting-started guide describe current usage. Hosted cloud
gateway work remains a later phase.

## Decision

Keep one model-agnostic adapter running. Client model pickers choose the model and
reasoning effort per request; the adapter validates the choice against the live
GitHub Copilot seat and switches the active SDK session without restarting.

## Supported scope

| Surface | Target behavior |
| --- | --- |
| Codex CLI | All Copilot models in `/model`; per-model effort in the same picker |
| Codex VS Code extension | Same generated catalog; `/model` and `/reasoning` |
| Codex Desktop | Same global catalog; validate against its embedded Codex version |
| Claude Code CLI | All Copilot **Claude-family** models from `/v1/models`; `/model` and `/effort` |
| Claude Code VS Code | Same gateway discovery and dynamic effort as the CLI |
| Claude Code Desktop | Local third-party inference configuration; validate its model menu |
| Hosted/cloud surfaces | Later phase requiring a remotely reachable, per-user gateway |

Claude Code is not a supported host for GPT, Gemini, Grok, or other non-Claude
Copilot models. Its gateway discovery filters out IDs without `claude` or
`anthropic`, and Anthropic explicitly does not support non-Claude models through
Claude Code gateways. We will not disguise those models with fake Claude IDs.

## Architecture

### 1. Live model registry

- Fetch `CopilotClient.listModels()` at startup and on an explicit refresh.
- Remove models disabled by the organization policy.
- Cache ID, display name, capabilities, context limits, supported reasoning
  efforts, default effort, and billing multiplier.
- Make this registry the only authority for request validation and discovery.

### 2. Codex catalog generator

- Add `copilot-adapter models sync`.
- Generate `~/.copilot-harness/codex-models.json` from the live registry.
- Add `model_catalog_json` and the Copilot provider to the user-level Codex
  configuration.
- Stop requiring a fixed model during `setup codex`; accept an optional
  `--default-model` only for the initial selection.
- Generate a catalog compatible with the installed Codex CLI and Desktop's
  embedded Codex binary. Validate it with `codex debug models` before replacing
  the previous catalog.

Codex loads a local catalog at client startup. Switching models afterward is
immediate and does not restart the adapter. A Codex restart is needed only after
the organization adds or removes models and the catalog is resynchronized.

### 3. Claude gateway discovery

- Keep `/v1/models?limit=1000`, but return current Claude-family Copilot models
  with stable IDs and display names.
- Keep `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` in every Claude setup.
- Stop writing `ANTHROPIC_MODEL` by default and stop requiring `--model` during
  setup. An optional default remains available.
- Claude Code refreshes the model list when it starts; `/model` then switches
  within the running session.

### 4. Per-request model and effort routing

- Extract Codex effort from Responses API `reasoning.effort`.
- Extract Claude Code effort from Messages API `output_config.effort`.
- Track both `model` and `reasoningEffort` in conversation state.
- Call `session.setModel(model, { reasoningEffort })` when either value changes;
  the Copilot SDK preserves conversation history.
- On new sessions, pass the selected model and effort to `createSession`.
- Reject unavailable models or unsupported effort levels with the exact valid
  choices; never silently substitute a nearby model.

### 5. Surface rollout

1. Codex CLI and Claude Code CLI.
2. Codex and Claude Code VS Code extensions.
3. Codex Desktop and Claude Code Desktop local Code tabs.
4. Hosted/cloud architecture: remote TLS gateway, per-user identity, policy,
   audit, and a confirmed GitHub licensing/authentication model.

## Verification

1. Start one adapter process and leave it running.
2. Codex `/model` lists every model returned for the Copilot seat; switch across
   GPT, Claude, and Gemini families in one chat.
3. Codex picker and `/reasoning` change the effective SDK reasoning effort.
4. Claude Code `/model` lists every available Claude-family Copilot model and
   `/effort` changes the effective SDK effort.
5. Repeat the matrix in both VS Code extensions and both desktop local modes.
6. Logs and status report the requested and effective model/effort for every turn.
7. Existing security, rollback, protocol, and live smoke suites remain green.

## Primary references

- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
- [Codex developer commands](https://developers.openai.com/codex/cli/reference)
- [Claude Code gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol)
- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [GitHub Copilot supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
