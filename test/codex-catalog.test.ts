import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelInfo } from "@github/copilot-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexCatalog, writeCodexCatalog } from "#codex-catalog.js";

const temporaryDirectories: string[] = [];

function model(
  id: string,
  options?: {
    policy?: "enabled" | "disabled" | "unconfigured";
    efforts?: ModelInfo["supportedReasoningEfforts"];
    defaultEffort?: ModelInfo["defaultReasoningEffort"];
  },
): ModelInfo {
  return {
    id,
    name: id.toUpperCase(),
    capabilities: {
      supports: {
        vision: false,
        reasoningEffort: Boolean(options?.efforts?.length),
      },
      limits: { max_context_window_tokens: 200_000 },
    },
    ...(options?.policy && {
      policy: { state: options.policy, terms: "" },
    }),
    ...(options?.efforts && {
      supportedReasoningEfforts: options.efforts,
    }),
    ...(options?.defaultEffort && {
      defaultReasoningEffort: options.defaultEffort,
    }),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("Codex model catalog", () => {
  it("maps enabled Copilot models and their exact effort choices", () => {
    const catalog = createCodexCatalog([
      model("gpt-5", {
        policy: "enabled",
        efforts: ["low", "high"],
        defaultEffort: "high",
      }),
      model("disabled-model", { policy: "disabled" }),
    ]);

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]).toMatchObject({
      slug: "gpt-5",
      display_name: "GPT-5",
      default_reasoning_level: "high",
      input_modalities: ["text"],
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
    });
  });

  it("writes an atomic private catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "copilot-catalog-"));
    temporaryDirectories.push(directory);
    const targetPath = join(directory, "catalog.json");

    const result = await writeCodexCatalog(
      [model("claude-sonnet")],
      targetPath,
    );
    const catalog = JSON.parse(await readFile(targetPath, "utf8")) as {
      models: { slug: string }[];
    };

    expect(result).toEqual({ targetPath, modelCount: 1 });
    expect(catalog.models[0]?.slug).toBe("claude-sonnet");
    expect((await stat(targetPath)).mode & 0o777).toBe(0o600);
  });
});
