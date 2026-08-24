import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateToolArguments } from "#security.js";

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "copilot-harness-security-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("workspace path validation", () => {
  it("allows paths contained in the workspace", async () => {
    const root = await workspace();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "app.ts"), "export {};\n");
    await expect(
      validateToolArguments(root, { file_path: "src/app.ts" }),
    ).resolves.toBeUndefined();
  });

  it("rejects parent traversal", async () => {
    const root = await workspace();
    await expect(
      validateToolArguments(root, { path: "../secret.txt" }),
    ).rejects.toThrow("escapes");
  });

  it("rejects symlinks that resolve outside the workspace", async () => {
    const root = await workspace();
    const outside = await workspace();
    await symlink(outside, join(root, "outside"));
    await expect(
      validateToolArguments(root, { directory: "outside" }),
    ).rejects.toThrow("symlink");
  });

  it("does not treat file content as a path", async () => {
    const root = await workspace();
    await expect(
      validateToolArguments(root, { content: "../../shown in documentation" }),
    ).resolves.toBeUndefined();
  });
});
