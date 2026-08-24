import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSON5 from "json5";
import { afterEach, describe, expect, it } from "vitest";
import {
  restoreClientSetup,
  setupClaudeCli,
  setupClaudeVsCode,
  setupCodex,
} from "../src/client-setup.js";

const temporaryDirectories: string[] = [];

async function temporaryTarget(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "copilot-harness-setup-"));
  temporaryDirectories.push(directory);
  return join(directory, name);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("Codex setup", () => {
  it("patches global config and restores the exact original bytes", async () => {
    const targetPath = await temporaryTarget("config.toml");
    const original =
      'model = "personal"\r\nmodel_provider = "openai"\r\n\r\n[features]\r\napps = true\r\n';
    await writeFile(targetPath, original, { mode: 0o640 });

    const result = await setupCodex({
      scope: "global",
      binaryPath: "/opt/copilot-harness",
      port: 4141,
      model: "gpt-5.4",
      targetPath,
    });
    const configured = await readFile(targetPath, "utf8");
    expect(configured).toContain('model_provider = "copilot_harness"');
    expect(configured).toContain('base_url = "http://127.0.0.1:4141/v1"');
    expect(configured).toContain('command = "/opt/copilot-harness"');
    expect(configured).toContain("model_catalog_json = ");
    expect(configured).toContain(
      '# copilot-harness:replaced model = "personal"',
    );
    expect((await stat(result.backupPath)).mode & 0o777).toBe(0o600);

    expect(await restoreClientSetup(targetPath)).toBe(true);
    expect(await readFile(targetPath, "utf8")).toBe(original);
    expect((await stat(targetPath)).mode & 0o777).toBe(0o640);
  });

  it("creates a profile and removes it when restoring a missing original", async () => {
    const targetPath = await temporaryTarget("copilot.config.toml");
    await setupCodex({
      scope: "profile",
      binaryPath: "/opt/copilot-harness",
      port: 4141,
      model: "gpt-5.4",
      targetPath,
    });

    expect(await restoreClientSetup(targetPath)).toBe(true);
    await expect(readFile(targetPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await restoreClientSetup(targetPath)).toBe(false);
  });

  it("disables an existing profile selection to avoid duplicate TOML keys", async () => {
    const targetPath = await temporaryTarget("copilot.config.toml");
    await writeFile(
      targetPath,
      'model = "old"\nmodel_provider = "old-provider"\n',
    );

    await setupCodex({
      scope: "profile",
      binaryPath: "/opt/copilot-harness",
      port: 4141,
      model: "gpt-5.4",
      targetPath,
    });

    const configured = await readFile(targetPath, "utf8");
    expect(configured.match(/^model =/gm)).toHaveLength(1);
    expect(configured.match(/^model_provider =/gm)).toHaveLength(1);
  });

  it("configures the picker without pinning a default model", async () => {
    const targetPath = await temporaryTarget("config.toml");
    await setupCodex({
      scope: "global",
      binaryPath: "/opt/copilot-harness",
      port: 4141,
      catalogPath: "/tmp/copilot-models.json",
      targetPath,
    });

    const configured = await readFile(targetPath, "utf8");
    expect(configured).not.toMatch(/^model =/m);
    expect(configured).toContain(
      'model_catalog_json = "/tmp/copilot-models.json"',
    );
  });

  it("keeps existing top-level settings outside the managed provider table", async () => {
    const targetPath = await temporaryTarget("config.toml");
    await writeFile(
      targetPath,
      'approval_policy = "on-request"\n\n[features]\napps = true\n',
    );

    await setupCodex({
      scope: "global",
      binaryPath: "/opt/copilot-harness",
      port: 4141,
      model: "gpt-5.4",
      targetPath,
    });

    const configured = await readFile(targetPath, "utf8");
    expect(configured.indexOf('approval_policy = "on-request"')).toBeLessThan(
      configured.indexOf("[features]"),
    );
    expect(configured.indexOf('approval_policy = "on-request"')).toBeLessThan(
      configured.indexOf("[model_providers.copilot_harness]"),
    );
  });

  it("supports repeat setup when the managed file is unchanged", async () => {
    const targetPath = await temporaryTarget("config.toml");
    const original = 'approval_policy = "on-request"\n';
    await writeFile(targetPath, original);
    const common = {
      scope: "global" as const,
      binaryPath: "/opt/copilot-harness",
      model: "gpt-5.4",
      targetPath,
    };

    await setupCodex({ ...common, port: 4141 });
    await setupCodex({ ...common, port: 5151 });
    expect(await readFile(targetPath, "utf8")).toContain("127.0.0.1:5151");

    expect(await restoreClientSetup(targetPath)).toBe(true);
    expect(await readFile(targetPath, "utf8")).toBe(original);
  });

  it("refuses setup and restore after user edits the managed file", async () => {
    const targetPath = await temporaryTarget("config.toml");
    await writeFile(targetPath, 'approval_policy = "on-request"\n');
    const options = {
      scope: "global" as const,
      binaryPath: "/opt/copilot-harness",
      port: 4141,
      model: "gpt-5.4",
      targetPath,
    };
    await setupCodex(options);
    const edited = `${await readFile(targetPath, "utf8")}\n# user edit\n`;
    await writeFile(targetPath, edited);

    await expect(setupCodex(options)).rejects.toThrow("changed after");
    await expect(restoreClientSetup(targetPath)).rejects.toThrow(
      "changed after",
    );
    expect(await readFile(targetPath, "utf8")).toBe(edited);
  });
});

describe("Claude client setup", () => {
  it("preserves unrelated Claude CLI settings and uses the credential helper", async () => {
    const targetPath = await temporaryTarget("settings.json");
    await writeFile(
      targetPath,
      '{"permissions":{"allow":["Read"]},"env":{"KEEP":"yes"}}\n',
    );

    await setupClaudeCli({
      binaryPath: "/Applications/Harness Tool/bin/copilot-harness",
      port: 5151,
      model: "claude-sonnet-4.5",
      targetPath,
    });
    const configured = JSON.parse(await readFile(targetPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(configured.permissions).toEqual({ allow: ["Read"] });
    expect(configured.env).toMatchObject({
      KEEP: "yes",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:5151",
      ANTHROPIC_MODEL: "claude-sonnet-4.5",
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
      CLAUDE_CODE_USE_FOUNDRY: "0",
      CLAUDE_CODE_USE_BEDROCK: "0",
      CLAUDE_CODE_USE_VERTEX: "0",
    });
    expect(configured.apiKeyHelper).toBe(
      '"/Applications/Harness Tool/bin/copilot-harness" token',
    );
  });

  it("updates VS Code JSONC without losing unrelated settings or variables", async () => {
    const targetPath = await temporaryTarget("settings.json");
    await writeFile(
      targetPath,
      '{\n  // keep this setting value\n  "editor.fontSize": 15,\n  "claudeCode.environmentVariables": [\n    { "name": "KEEP", "value": "yes" },\n    { "name": "ANTHROPIC_BASE_URL", "value": "old" },\n  ],\n}\n',
    );

    await setupClaudeVsCode({
      token: "local-secret",
      port: 6161,
      model: "claude-opus-4.1",
      targetPath,
    });
    const configured = JSON5.parse(
      await readFile(targetPath, "utf8"),
    ) as Record<string, unknown>;
    expect(configured["editor.fontSize"]).toBe(15);
    expect(configured["claudeCode.environmentVariables"]).toEqual([
      { name: "KEEP", value: "yes" },
      { name: "ANTHROPIC_BASE_URL", value: "http://127.0.0.1:6161" },
      { name: "ANTHROPIC_AUTH_TOKEN", value: "local-secret" },
      { name: "ANTHROPIC_MODEL", value: "claude-opus-4.1" },
      { name: "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", value: "1" },
      { name: "CLAUDE_CODE_USE_FOUNDRY", value: "0" },
      { name: "CLAUDE_CODE_USE_BEDROCK", value: "0" },
      { name: "CLAUDE_CODE_USE_VERTEX", value: "0" },
    ]);
    expect(await readFile(targetPath, "utf8")).toContain(
      "// keep this setting value",
    );
  });

  it("enables Claude discovery without pinning a model", async () => {
    const cliTarget = await temporaryTarget("claude-settings.json");
    await writeFile(cliTarget, '{"env":{"ANTHROPIC_MODEL":"old"}}\n');
    await setupClaudeCli({
      binaryPath: "/opt/copilot-harness",
      port: 4141,
      targetPath: cliTarget,
    });
    const cli = JSON.parse(await readFile(cliTarget, "utf8")) as {
      env: Record<string, string>;
    };
    expect(cli.env.ANTHROPIC_MODEL).toBeUndefined();
    expect(cli.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBe("1");
    expect(cli.env.CLAUDE_CODE_USE_FOUNDRY).toBe("0");

    const vscodeTarget = await temporaryTarget("vscode-settings.json");
    await setupClaudeVsCode({
      token: "local-secret",
      port: 4141,
      targetPath: vscodeTarget,
    });
    const vscode = JSON.parse(await readFile(vscodeTarget, "utf8")) as {
      "claudeCode.environmentVariables": { name: string }[];
    };
    expect(
      vscode["claudeCode.environmentVariables"].some(
        (entry) => entry.name === "ANTHROPIC_MODEL",
      ),
    ).toBe(false);
  });
});

describe("setup validation", () => {
  it("refuses automatic restore from a legacy backup without a checksum", async () => {
    const targetPath = await temporaryTarget("settings.json");
    await writeFile(targetPath, '{"managed":true}\n');
    await writeFile(
      `${targetPath}.copilot-harness.backup.json`,
      `${JSON.stringify({ version: 1, existed: true, contentBase64: Buffer.from("{}\n").toString("base64") })}\n`,
    );

    await expect(restoreClientSetup(targetPath)).rejects.toThrow(
      "legacy backup",
    );
    expect(await readFile(targetPath, "utf8")).toBe('{"managed":true}\n');
  });

  it("rejects a relative credential-helper path before writing", async () => {
    const targetPath = await temporaryTarget("settings.json");
    await expect(
      setupClaudeCli({
        binaryPath: "copilot-harness",
        port: 4141,
        model: "claude-sonnet-4.5",
        targetPath,
      }),
    ).rejects.toThrow("binaryPath must be absolute");
    await expect(readFile(targetPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
