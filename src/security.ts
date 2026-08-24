import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { BuiltInTools } from "@github/copilot-sdk";

const PATH_KEY =
  /^(?:path|file|filePath|file_path|directory|directoryPath|directory_path|folder|folderPath|folder_path|cwd|root|rootPath|root_path|glob)$/i;

export function isIsolatedTool(toolName: string): boolean {
  return BuiltInTools.Isolated.includes(toolName);
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

async function nearestExistingPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return nearestExistingPath(parent);
  }
}

async function assertWorkspacePath(workspace: string, value: string) {
  if (value.includes("\0") || value.startsWith("~")) {
    throw new Error("unsafe workspace path");
  }
  const candidate = isAbsolute(value)
    ? resolve(value)
    : resolve(workspace, value);
  if (!isWithin(workspace, candidate)) {
    throw new Error("path escapes the configured workspace");
  }
  const existing = await nearestExistingPath(candidate);
  if (!isWithin(workspace, existing)) {
    throw new Error("path resolves through a symlink outside the workspace");
  }
}

async function validateValue(
  workspace: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (typeof value === "string" && PATH_KEY.test(key)) {
    await assertWorkspacePath(workspace, value);
    return;
  }
  if (Array.isArray(value)) {
    await Promise.all(value.map((item) => validateValue(workspace, key, item)));
    return;
  }
  if (value && typeof value === "object") {
    await Promise.all(
      Object.entries(value).map(([childKey, childValue]) =>
        validateValue(workspace, childKey, childValue),
      ),
    );
  }
}

export async function validateToolArguments(
  workspace: string,
  toolArgs: unknown,
): Promise<void> {
  const canonicalWorkspace = await realpath(workspace);
  await validateValue(canonicalWorkspace, "args", toolArgs);
}
