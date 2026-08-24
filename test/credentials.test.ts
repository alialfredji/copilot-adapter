import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getOrCreateToken,
  readToken,
  resolveTokenPath,
  rotateToken,
} from "../src/credentials.js";

const temporaryDirectories: string[] = [];

async function temporaryHome(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "copilot-harness-credentials-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("credentials", () => {
  it("creates and reuses a 32-byte token with private permissions", async () => {
    const homeDir = await temporaryHome();
    const first = await getOrCreateToken({ homeDir });
    const second = await getOrCreateToken({ homeDir });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect((await stat(resolveTokenPath({ homeDir }))).mode & 0o777).toBe(
      0o600,
    );
    expect((await stat(homeDir)).mode & 0o777).toBe(0o700);
  });

  it("rotates the token atomically", async () => {
    const homeDir = await temporaryHome();
    const first = await getOrCreateToken({ homeDir });
    const second = await rotateToken({ homeDir });

    expect(second).not.toBe(first);
    expect(await readToken({ homeDir })).toBe(second);
  });

  it("returns null for a missing token and rejects malformed content", async () => {
    const homeDir = await temporaryHome();
    expect(await readToken({ homeDir })).toBeNull();

    await writeFile(resolveTokenPath({ homeDir }), "not-a-token\n");
    await expect(readToken({ homeDir })).rejects.toThrow(
      "Invalid Copilot Harness token",
    );
    expect(await readFile(resolveTokenPath({ homeDir }), "utf8")).toBe(
      "not-a-token\n",
    );
  });
});
