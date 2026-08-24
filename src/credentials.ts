import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export type CredentialOptions = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
};

export function resolveHarnessHome(options: CredentialOptions = {}): string {
  const env = options.env ?? process.env;
  return (
    options.homeDir ??
    env.COPILOT_HARNESS_HOME ??
    join(homedir(), ".copilot-harness")
  );
}

export function resolveTokenPath(options: CredentialOptions = {}): string {
  return join(resolveHarnessHome(options), "token");
}

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

function validateToken(value: string): string {
  const token = value.trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid Copilot Harness token file");
  }
  return token;
}

async function ensureHome(options: CredentialOptions): Promise<void> {
  await mkdir(resolveHarnessHome(options), { recursive: true, mode: 0o700 });
  await chmod(resolveHarnessHome(options), 0o700);
}

export async function readToken(
  options: CredentialOptions = {},
): Promise<string | null> {
  const tokenPath = resolveTokenPath(options);
  try {
    const token = validateToken(await readFile(tokenPath, "utf8"));
    await chmod(tokenPath, 0o600);
    return token;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function getOrCreateToken(
  options: CredentialOptions = {},
): Promise<string> {
  await ensureHome(options);
  const current = await readToken(options);
  if (current) return current;

  const token = generateToken();
  const tokenPath = resolveTokenPath(options);
  try {
    const handle = await open(tokenPath, "wx", 0o600);
    try {
      await handle.writeFile(`${token}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return token;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      const existing = await readToken(options);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function rotateToken(
  options: CredentialOptions = {},
): Promise<string> {
  await ensureHome(options);
  const token = generateToken();
  const tokenPath = resolveTokenPath(options);
  const temporaryPath = `${tokenPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${token}\n`, "utf8");
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, tokenPath);
    await chmod(tokenPath, 0o600);
    return token;
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
