import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import JSON5 from "json5";
import { applyEdits, modify } from "jsonc-parser";
import { defaultCodexCatalogPath } from "#codex-catalog.js";

const PROVIDER_ID = "copilot_harness";
const LEGACY_START_MARKER = "# copilot-harness:start";
const LEGACY_END_MARKER = "# copilot-harness:end";
const SELECTION_START_MARKER = "# copilot-harness:selection-start";
const SELECTION_END_MARKER = "# copilot-harness:selection-end";
const PROVIDER_START_MARKER = "# copilot-harness:provider-start";
const PROVIDER_END_MARKER = "# copilot-harness:provider-end";
const BACKUP_SUFFIX = ".copilot-harness.backup";
const BACKUP_METADATA_SUFFIX = ".copilot-harness.backup.meta.json";
const LEGACY_BACKUP_SUFFIX = ".copilot-harness.backup.json";

export type SetupResult = {
  targetPath: string;
  backupPath: string;
};

export type CodexSetupOptions = {
  scope: "profile" | "global";
  binaryPath: string;
  port: number;
  model?: string;
  catalogPath?: string;
  targetPath?: string;
};

export type ClaudeCliSetupOptions = {
  binaryPath: string;
  port: number;
  model?: string;
  targetPath?: string;
};

export type ClaudeVsCodeSetupOptions = {
  token: string;
  port: number;
  model?: string;
  targetPath?: string;
};

type LegacyBackupRecord = {
  version: 1 | 2;
  existed: boolean;
  contentBase64?: string;
  mode?: number;
  installedSha256?: string;
};

type BackupMetadata = {
  version: 3;
  existed: boolean;
  mode?: number;
};

type JsonObject = Record<string, unknown>;

function validateCommon(port: number, model?: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be an integer between 1 and 65535");
  }
  if (model !== undefined && !model.trim()) {
    throw new Error("Model must not be empty");
  }
}

function validateBinaryPath(binaryPath: string): void {
  if (!isAbsolute(binaryPath)) {
    throw new Error("binaryPath must be absolute");
  }
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value as JsonObject;
}

async function readOriginal(
  targetPath: string,
): Promise<{ existed: boolean; content: Buffer; mode?: number }> {
  try {
    const [content, metadata] = await Promise.all([
      readFile(targetPath),
      stat(targetPath),
    ]);
    return { existed: true, content, mode: metadata.mode & 0o777 };
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { existed: false, content: Buffer.alloc(0) };
    }
    throw error;
  }
}

async function atomicWrite(
  targetPath: string,
  content: string | Buffer,
  mode: number,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, content, { mode, flag: "wx" });
    await rename(temporaryPath, targetPath);
    await chmod(targetPath, mode);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function saveBackup(
  targetPath: string,
  original: Awaited<ReturnType<typeof readOriginal>>,
): Promise<string> {
  const backupPath = `${targetPath}${BACKUP_SUFFIX}`;
  const metadataPath = `${targetPath}${BACKUP_METADATA_SUFFIX}`;
  const legacyBackupPath = `${targetPath}${LEGACY_BACKUP_SUFFIX}`;
  const metadata: BackupMetadata = {
    version: 3,
    existed: original.existed,
    ...(original.mode !== undefined && { mode: original.mode }),
  };

  try {
    const existing = parseBackupMetadata(await readFile(metadataPath, "utf8"));
    if (existing.existed) await readFile(backupPath);
    return backupPath;
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }

  try {
    await readFile(legacyBackupPath);
    throw new Error(
      `Existing legacy backup ${legacyBackupPath} must be restored with --remove before running setup again`,
    );
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }

  let wroteBackup = false;
  try {
    if (original.existed) {
      await writeFile(backupPath, original.content, {
        mode: 0o600,
        flag: "wx",
      });
      wroteBackup = true;
    }
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (wroteBackup) await unlink(backupPath).catch(() => undefined);
    throw error;
  }
  return backupPath;
}

function parseLegacyBackup(source: string): LegacyBackupRecord {
  const record = JSON.parse(source) as LegacyBackupRecord;
  if (
    (record.version !== 1 && record.version !== 2) ||
    typeof record.existed !== "boolean"
  ) {
    throw new Error("Invalid Copilot Harness backup");
  }
  return record;
}

function parseBackupMetadata(source: string): BackupMetadata {
  const metadata = JSON.parse(source) as BackupMetadata;
  if (metadata.version !== 3 || typeof metadata.existed !== "boolean") {
    throw new Error("Invalid Copilot Harness backup metadata");
  }
  return metadata;
}

async function installConfig(
  targetPath: string,
  transform: (source: string) => string,
): Promise<SetupResult> {
  const original = await readOriginal(targetPath);
  const output = transform(original.content.toString("utf8"));
  await mkdir(dirname(targetPath), { recursive: true });
  const backupPath = await saveBackup(targetPath, original);
  await atomicWrite(targetPath, output, 0o600);
  return { targetPath, backupPath };
}

function stripBlock(source: string, startMarker: string, endMarker: string) {
  let output = source;
  for (;;) {
    const start = output.indexOf(startMarker);
    if (start === -1) return output;
    const end = output.indexOf(endMarker, start);
    if (end === -1) throw new Error("Incomplete Copilot Harness TOML block");
    const after = end + endMarker.length;
    output = `${output.slice(0, start)}${output.slice(after).replace(/^\r?\n/, "")}`;
  }
}

function stripManagedToml(source: string): string {
  let output = source;
  const markerPairs = [
    [LEGACY_START_MARKER, LEGACY_END_MARKER],
    [SELECTION_START_MARKER, SELECTION_END_MARKER],
    [PROVIDER_START_MARKER, PROVIDER_END_MARKER],
  ] as const;
  for (const [start, end] of markerPairs) {
    output = stripBlock(output, start, end);
  }
  return output;
}

function assertCodexProviderAvailable(source: string) {
  if (/^\s*\[model_providers\.copilot_harness(?:\]|\.)/m.test(source)) {
    throw new Error(
      'Codex config already contains an unmanaged "copilot_harness" provider',
    );
  }
}

function disableTopLevelCodexSelection(source: string): string {
  const lines = source.split(/\r?\n/);
  let inTable = false;
  return lines
    .map((line) => {
      if (/^\s*\[/.test(line)) inTable = true;
      if (
        !inTable &&
        /^\s*(model|model_provider|model_catalog_json)\s*=/.test(line)
      ) {
        return `# copilot-harness:replaced ${line}`;
      }
      return line;
    })
    .join("\n");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexSelection(options: CodexSetupOptions): string {
  const values = [
    SELECTION_START_MARKER,
    ...(options.model ? [`model = ${tomlString(options.model)}`] : []),
    `model_provider = ${tomlString(PROVIDER_ID)}`,
    `model_catalog_json = ${tomlString(options.catalogPath ?? defaultCodexCatalogPath())}`,
    SELECTION_END_MARKER,
  ];
  return values.join("\n");
}

function codexProvider(options: CodexSetupOptions): string {
  const baseUrl = `http://127.0.0.1:${options.port}/v1`;
  return [
    PROVIDER_START_MARKER,
    `[model_providers.${PROVIDER_ID}]`,
    'name = "GitHub Copilot via local adapter"',
    `base_url = ${tomlString(baseUrl)}`,
    'wire_api = "responses"',
    "",
    `[model_providers.${PROVIDER_ID}.auth]`,
    `command = ${tomlString(options.binaryPath)}`,
    'args = ["token"]',
    "refresh_interval_ms = 300000",
    PROVIDER_END_MARKER,
  ].join("\n");
}

export function defaultCodexPath(scope: "profile" | "global"): string {
  return join(
    process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    scope === "profile" ? "copilot.config.toml" : "config.toml",
  );
}

export async function setupCodex(
  options: CodexSetupOptions,
): Promise<SetupResult> {
  validateCommon(options.port, options.model);
  validateBinaryPath(options.binaryPath);
  const targetPath = options.targetPath ?? defaultCodexPath(options.scope);
  return installConfig(targetPath, (source) => {
    const unmanaged = stripManagedToml(source);
    assertCodexProviderAvailable(unmanaged);
    const existing = disableTopLevelCodexSelection(unmanaged).trim();
    return [codexSelection(options), existing, codexProvider(options)]
      .filter(Boolean)
      .join("\n\n")
      .concat("\n");
  });
}

function parseJsonConfig(source: string, label: string): JsonObject {
  if (!source.trim()) return {};
  try {
    return asObject(JSON5.parse(source), label);
  } catch (error) {
    throw new Error(
      `Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function helperCommand(binaryPath: string): string {
  const escaped = binaryPath.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}" token`;
}

export function defaultClaudeCliPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

export async function setupClaudeCli(
  options: ClaudeCliSetupOptions,
): Promise<SetupResult> {
  validateCommon(options.port, options.model);
  validateBinaryPath(options.binaryPath);
  const targetPath = options.targetPath ?? defaultClaudeCliPath();
  return installConfig(targetPath, (source) => {
    const config = parseJsonConfig(source, "Claude settings");
    const env =
      config.env === undefined
        ? {}
        : asObject(config.env, "Claude settings env");
    delete env.ANTHROPIC_MODEL;
    config.env = {
      ...env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${options.port}`,
      ...(options.model && { ANTHROPIC_MODEL: options.model }),
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
      CLAUDE_CODE_USE_FOUNDRY: "0",
      CLAUDE_CODE_USE_BEDROCK: "0",
      CLAUDE_CODE_USE_VERTEX: "0",
    };
    config.apiKeyHelper = helperCommand(options.binaryPath);
    return `${JSON.stringify(config, null, 2)}\n`;
  });
}

export function defaultClaudeVsCodePath(): string {
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "Code", "User")
      : process.platform === "win32"
        ? join(process.env.APPDATA ?? homedir(), "Code", "User")
        : join(
            process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
            "Code",
            "User",
          );
  return join(base, "settings.json");
}

export async function setupClaudeVsCode(
  options: ClaudeVsCodeSetupOptions,
): Promise<SetupResult> {
  validateCommon(options.port, options.model);
  if (!options.token.trim()) throw new Error("Token must not be empty");
  const targetPath = options.targetPath ?? defaultClaudeVsCodePath();
  return installConfig(targetPath, (source) => {
    const config = parseJsonConfig(source, "VS Code settings");
    const key = "claudeCode.environmentVariables";
    const current = config[key] ?? [];
    if (!Array.isArray(current)) {
      throw new Error(`${key} must be an array`);
    }
    const owned = new Set([
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_MODEL",
      "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
      "CLAUDE_CODE_USE_FOUNDRY",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
    ]);
    const preserved = current.filter((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return true;
      return !owned.has(String((entry as JsonObject).name ?? ""));
    });
    const nextVariables = [
      ...preserved,
      { name: "ANTHROPIC_BASE_URL", value: `http://127.0.0.1:${options.port}` },
      { name: "ANTHROPIC_AUTH_TOKEN", value: options.token },
      ...(options.model
        ? [{ name: "ANTHROPIC_MODEL", value: options.model }]
        : []),
      { name: "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", value: "1" },
      { name: "CLAUDE_CODE_USE_FOUNDRY", value: "0" },
      { name: "CLAUDE_CODE_USE_BEDROCK", value: "0" },
      { name: "CLAUDE_CODE_USE_VERTEX", value: "0" },
    ];
    const jsonc = source.trim() ? source : "{}\n";
    const output = applyEdits(
      jsonc,
      modify(jsonc, [key], nextVariables, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
      }),
    );
    return output.endsWith("\n") ? output : `${output}\n`;
  });
}

export async function restoreClientSetup(targetPath: string): Promise<boolean> {
  const backupPath = `${targetPath}${BACKUP_SUFFIX}`;
  const metadataPath = `${targetPath}${BACKUP_METADATA_SUFFIX}`;
  const legacyBackupPath = `${targetPath}${LEGACY_BACKUP_SUFFIX}`;
  let metadata: BackupMetadata;
  try {
    metadata = parseBackupMetadata(await readFile(metadataPath, "utf8"));
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;

    return restoreLegacyBackup(targetPath, legacyBackupPath);
  }

  if (metadata.existed) {
    const original = await readFile(backupPath);
    await atomicWrite(targetPath, original, metadata.mode ?? 0o600);
  } else {
    await unlinkIfPresent(targetPath);
  }
  await unlink(metadataPath);
  await unlinkIfPresent(backupPath);
  return true;
}

async function restoreLegacyBackup(
  targetPath: string,
  backupPath: string,
): Promise<boolean> {
  let record: LegacyBackupRecord;
  try {
    record = parseLegacyBackup(await readFile(backupPath, "utf8"));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  if (record.existed) {
    if (record.contentBase64 === undefined) {
      throw new Error("Invalid Copilot Harness backup: missing content");
    }
    await atomicWrite(
      targetPath,
      Buffer.from(record.contentBase64, "base64"),
      record.mode ?? 0o600,
    );
  } else {
    await unlinkIfPresent(targetPath);
  }
  await unlink(backupPath);
  return true;
}

async function unlinkIfPresent(targetPath: string): Promise<void> {
  await unlink(targetPath).catch((error: unknown) => {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  });
}
