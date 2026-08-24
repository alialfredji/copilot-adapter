import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelInfo } from "@github/copilot-sdk";
import { resolveHarnessHome } from "#credentials.js";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const INSTRUCTIONS =
  "You are Codex, a coding agent. Follow the user's instructions, use tools carefully, and continue until the task is complete.";

const EFFORT_DESCRIPTIONS: Record<string, string> = {
  low: "Fast responses with lighter reasoning",
  medium: "Balances speed and reasoning depth",
  high: "Greater reasoning depth for complex tasks",
  xhigh: "Extra-high reasoning depth for complex tasks",
};

export type CodexCatalog = {
  models: Record<string, unknown>[];
};

export function defaultCodexCatalogPath(): string {
  return join(resolveHarnessHome(), "codex-models.json");
}

export function createCodexCatalog(models: ModelInfo[]): CodexCatalog {
  const enabled = models.filter((model) => model.policy?.state !== "disabled");
  return {
    models: enabled.map((model, index) => {
      const efforts = model.supportedReasoningEfforts ?? [];
      const contextWindow =
        model.capabilities.limits.max_context_window_tokens ||
        DEFAULT_CONTEXT_WINDOW;
      return {
        slug: model.id,
        display_name: model.name,
        description: "Available through your GitHub Copilot subscription",
        default_reasoning_level:
          model.defaultReasoningEffort ?? efforts[0] ?? null,
        supported_reasoning_levels: efforts.map((effort) => ({
          effort,
          description: EFFORT_DESCRIPTIONS[effort] ?? `${effort} reasoning`,
        })),
        shell_type: "shell_command",
        // Required by older embedded Codex builds and ignored by newer ones.
        supports_parallel_tool_calls: true,
        visibility: "list",
        supported_in_api: true,
        priority: index + 1,
        availability_nux: null,
        upgrade: null,
        model_messages: {
          instructions_template: INSTRUCTIONS,
          instructions_variables: null,
          approvals: null,
        },
        support_verbosity: false,
        default_verbosity: null,
        apply_patch_tool_type: null,
        truncation_policy: { mode: "bytes", limit: 10_000 },
        context_window: contextWindow,
        max_context_window: contextWindow,
        experimental_supported_tools: [],
        // The adapter currently translates text and tool events only.
        input_modalities: ["text"],
        supports_image_detail_original: false,
      };
    }),
  };
}

export async function writeCodexCatalog(
  models: ModelInfo[],
  targetPath = defaultCodexCatalogPath(),
): Promise<{ targetPath: string; modelCount: number }> {
  const catalog = createCodexCatalog(models);
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, targetPath);
    await chmod(targetPath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { targetPath, modelCount: catalog.models.length };
}
