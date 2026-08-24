#!/usr/bin/env node
import { join, dirname, resolve as resolvePath } from "node:path";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { z } from "zod";
import { Command } from "commander";
import { CopilotService } from "#copilot-service.js";
import {
  loadConfig,
  loadAllProviderConfigs,
  resolveConfigPath,
} from "#config.js";
import type { AllProviderConfigs, ServerConfig } from "#config.js";
import { createServer } from "#server.js";
import { Logger } from "#logger.js";
import { Stats } from "#stats.js";
import { providers, createAutoProvider } from "#providers/index.js";
import type { Provider } from "#providers/types.js";
import type { AppContext } from "#context.js";
import type { ProviderMode } from "#schemas/config.js";
import {
  parsePort,
  parseLogLevel,
  parseProvider,
  parseIdleTimeout,
} from "#cli-validators.js";
import {
  bold,
  dim,
  createSpinner,
  printBanner,
  printUsageSummary,
} from "#ui.js";
import { applyPolicy, parsePolicy, type PolicyName } from "#policies.js";
import { getOrCreateToken, rotateToken } from "#credentials.js";
import { defaultCodexCatalogPath, writeCodexCatalog } from "#codex-catalog.js";
import {
  defaultClaudeCliPath,
  defaultClaudeVsCodePath,
  defaultCodexPath,
  restoreClientSetup,
  setupClaudeCli,
  setupClaudeVsCode,
  setupCodex,
} from "#client-setup.js";

const PACKAGE_ROOT = dirname(import.meta.dirname);
const DEFAULT_CONFIG_PATH = join(PACKAGE_ROOT, "config.json5");

const { version } = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf-8")),
  );

interface StartOptions {
  port: string;
  provider?: string;
  logLevel: string;
  config?: string;
  cwd?: string;
  idleTimeout?: string;
  policy: string;
}

function adapterBinaryPath(override?: string): string {
  return resolvePath(
    override ?? process.argv[1] ?? join(PACKAGE_ROOT, "dist", "cli.js"),
  );
}

function selectedDefaultModel(options: {
  defaultModel?: string;
  model?: string;
}): string | undefined {
  if (
    options.defaultModel &&
    options.model &&
    options.defaultModel !== options.model
  ) {
    throw new Error("--default-model and --model must match when both are set");
  }
  return options.defaultModel ?? options.model;
}

async function syncCodexModels(
  targetPath = defaultCodexCatalogPath(),
): Promise<{ targetPath: string; modelCount: number }> {
  const service = new CopilotService({ logLevel: "none" });
  await service.start();
  try {
    const auth = await service.getAuthStatus();
    if (!auth.isAuthenticated) {
      throw new Error(
        "GitHub authentication is required; run `copilot-harness login` first",
      );
    }
    return await writeCodexCatalog(await service.listModels(), targetPath);
  } finally {
    await service.stop();
  }
}

async function runGitHubLogin(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("gh", ["auth", "login"], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gh auth login exited with code ${String(code)}`));
    });
  });
}

async function fetchAdapter(path: string, port: number): Promise<unknown> {
  const token = await getOrCreateToken();
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Adapter returned HTTP ${String(response.status)}`);
  }
  return response.json();
}

async function loadProvider(
  mode: ProviderMode,
  configPath: string,
  logger: Logger,
  policy: PolicyName,
): Promise<{
  provider: Provider;
  config: ServerConfig;
  allConfigs?: AllProviderConfigs;
}> {
  if (mode === "auto") {
    const allConfigs = await loadAllProviderConfigs(configPath, logger);
    const securedProviders = Object.fromEntries(
      Object.entries(allConfigs.providers).map(([name, config]) => [
        name,
        applyPolicy(config, policy),
      ]),
    ) as AllProviderConfigs["providers"];
    return {
      provider: createAutoProvider(securedProviders),
      config: applyPolicy(allConfigs.shared, policy),
      allConfigs: { ...allConfigs, providers: securedProviders },
    };
  }
  const config = await loadConfig(configPath, logger, mode);
  return { provider: providers[mode], config: applyPolicy(config, policy) };
}

async function startServer(options: StartOptions): Promise<void> {
  const logLevel = parseLogLevel(options.logLevel);
  const logger = new Logger(logLevel);
  const port = parsePort(options.port);
  const mode: ProviderMode = options.provider
    ? parseProvider(options.provider)
    : "auto";
  const idleTimeoutMinutes = options.idleTimeout
    ? parseIdleTimeout(options.idleTimeout)
    : 0;
  const policy = parsePolicy(options.policy);

  const configPath =
    options.config ??
    resolveConfigPath(options.cwd, process.cwd(), DEFAULT_CONFIG_PATH);
  const { provider, config, allConfigs } = await loadProvider(
    mode,
    configPath,
    logger,
    policy,
  );
  const cwd = options.cwd;

  const service = new CopilotService({
    logLevel,
    logger,
    cwd,
  });

  const quiet = logLevel === "none";

  if (!quiet) {
    console.log();
    console.log(`  ${bold("copilot-harness")} ${dim(`v${version}`)}`);
    console.log();
  }

  const bootSpinner = quiet
    ? null
    : createSpinner("Initialising Copilot SDK...");
  await service.start();
  bootSpinner?.succeed("Copilot SDK initialised");

  const authSpinner = quiet ? null : createSpinner("Authenticating...");
  const auth = await service.getAuthStatus();
  if (!auth.isAuthenticated) {
    authSpinner?.fail("Not authenticated");
    logger.error(
      "Sign in with the Copilot CLI (copilot login) or GitHub CLI (gh auth login), or set a GITHUB_TOKEN environment variable.",
    );
    await service.stop();
    process.exit(1);
  }
  const login = auth.login ?? "unknown";
  const authType = auth.authType ?? "unknown";
  authSpinner?.succeed(
    `Authenticated as ${bold(login)} ${dim(`(${authType})`)}`,
  );

  const stats = new Stats();
  const ctx: AppContext = {
    service,
    logger,
    config,
    port,
    stats,
    workspace: service.cwd,
    policy,
  };
  await getOrCreateToken();
  // Resolve per request so `token --rotate` takes effect without restarting.
  const app = await createServer(ctx, provider, getOrCreateToken);

  let lastActivity = Date.now();
  app.addHook("onResponse", () => {
    lastActivity = Date.now();
  });

  const listenSpinner = quiet
    ? null
    : createSpinner(`Starting server on port ${String(port)}...`);
  const prevPinoLevel = app.log.level;
  app.log.level = "silent";
  await app.listen({ port, host: "127.0.0.1" });
  app.log.level = prevPinoLevel;
  listenSpinner?.succeed(
    `Listening on ${bold(`http://localhost:${String(port)}`)}`,
  );

  if (!quiet) {
    printBanner({
      port,
      provider: mode,
      providerName: provider.name,
      routes: [
        "GET /health",
        "GET /v1/models",
        "HEAD /api/hello",
        ...provider.routes,
      ],
      cwd: service.cwd,
    });
  }

  logger.debug(`Config loaded from ${configPath}`);
  const mcpCount = allConfigs
    ? Object.values(allConfigs.providers).reduce(
        (sum, c) => sum + Object.keys(c.mcpServers).length,
        0,
      )
    : Object.keys(config.mcpServers).length;
  const cliToolsSummary = config.allowedCliTools.includes("*")
    ? "all CLI tools allowed"
    : `${String(config.allowedCliTools.length)} allowed CLI tool(s)`;
  logger.debug(`${String(mcpCount)} MCP server(s), ${cliToolsSummary}`);
  logger.info(`Policy: ${policy}`);

  const shutdown = async (signal: string) => {
    process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
      logger.debug(`Ignoring error during shutdown: ${err.message}`);
    });

    logger.info(`Got ${signal}, shutting down...`);

    await app.close();

    const stopPromise = service.stop().then(() => {
      logger.info("Clean shutdown complete");
    });
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        logger.warn("Copilot client didn't stop in time, forcing exit");
        service.forceStop().then(resolve, resolve);
      }, 3000);
    });

    await Promise.race([stopPromise, timeoutPromise]);

    if (!quiet) {
      printUsageSummary(stats.snapshot());
    }

    process.exit(0);
  };

  let shuttingDown = false;
  const onSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdown(signal).catch((err: unknown) => {
      console.error("Shutdown error:", err);
      process.exit(1);
    });
  };
  process.on("SIGINT", () => {
    onSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    onSignal("SIGTERM");
  });

  if (idleTimeoutMinutes > 0) {
    const idleMs = idleTimeoutMinutes * 60_000;
    const checkInterval = Math.min(idleMs, 60_000);
    const timer = setInterval(() => {
      if (Date.now() - lastActivity >= idleMs) {
        clearInterval(timer);
        logger.info(
          `Idle for ${String(idleTimeoutMinutes)} minute(s), shutting down`,
        );
        onSignal("idle-timeout");
      }
    }, checkInterval);
    timer.unref();
  }
}

const program = new Command()
  .name("copilot-harness")
  .description("Secure local GitHub Copilot adapter for Codex and Claude Code")
  .version(version, "-v, --version");

program
  .command("start", { isDefault: true })
  .description("Start the local adapter")
  .option("-p, --port <number>", "port to listen on", "4141")
  .option("--provider <name>", "run a single provider: openai, claude, codex")
  .option("-l, --log-level <level>", "log verbosity", "info")
  .option("-c, --config <path>", "path to config file")
  .option("--cwd <path>", "working directory for Copilot sessions")
  .option(
    "--policy <name>",
    "chat, read-only, workspace-write, unsafe-shell, or unsafe-all",
    "read-only",
  )
  .option(
    "--idle-timeout <minutes>",
    "shut down after N minutes of inactivity",
    "0",
  )
  .action((options: StartOptions) => startServer(options));

program
  .command("token")
  .description("Print the local adapter token for a client credential helper")
  .option("--rotate", "replace the current local token")
  .action(async (options: { rotate?: boolean }) => {
    console.log(
      options.rotate ? await rotateToken() : await getOrCreateToken(),
    );
    if (options.rotate) {
      console.error(
        "Token rotated. Codex/Claude CLI update automatically; rerun `copilot-harness setup claude-vscode` and update Claude Desktop's API key.",
      );
    }
  });

program
  .command("login")
  .description("Authenticate GitHub for the Copilot SDK through gh CLI")
  .action(runGitHubLogin);

program
  .command("doctor")
  .description("Check the local prerequisites without starting the adapter")
  .action(async () => {
    const [nodeMajor = 0, nodeMinor = 0] = process.versions.node
      .split(".")
      .map((part) => Number.parseInt(part, 10));
    const nodeSupported =
      nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12);
    const copilot = spawnSync("copilot", ["--version"], { encoding: "utf8" });
    const hasEnvironmentToken = Boolean(
      process.env.COPILOT_GITHUB_TOKEN ??
      process.env.GH_TOKEN ??
      process.env.GITHUB_TOKEN,
    );
    const gh = spawnSync("gh", ["auth", "status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const hasSdkAuth = hasEnvironmentToken || gh.status === 0;
    await getOrCreateToken();
    console.log(
      `${nodeSupported ? "OK" : "FAIL"} Node ${process.versions.node} (22.12+ required)`,
    );
    console.log(
      `${copilot.status === 0 ? "OK" : "FAIL"} ${copilot.stdout.trim() || "GitHub Copilot CLI not found"}`,
    );
    console.log(
      `${hasSdkAuth ? "OK" : "FAIL"} SDK authentication (${hasEnvironmentToken ? "environment token" : "gh auth"})`,
    );
    console.log("OK local adapter credential");
    if (!nodeSupported || copilot.status !== 0 || !hasSdkAuth) {
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Check a running adapter and optionally list models")
  .option("-p, --port <number>", "adapter port", "4141")
  .option("--models", "list model IDs available to this Copilot seat")
  .action(async (options: { port: string; models?: boolean }) => {
    const port = parsePort(options.port);
    const health = await fetchAdapter("/health", port);
    console.log(JSON.stringify(health, null, 2));
    if (options.models) {
      const response = (await fetchAdapter("/v1/models?limit=1000", port)) as {
        data?: { id?: string; name?: string }[];
      };
      for (const model of response.data ?? []) {
        console.log(`${model.id ?? "unknown"}\t${model.name ?? ""}`.trim());
      }
    }
  });

const models = program
  .command("models")
  .description("Manage client model catalogs");

models
  .command("sync")
  .description("Sync Copilot models into the Codex model picker catalog")
  .option("--output <path>", "catalog output path")
  .action(async (options: { output?: string }) => {
    const result = await syncCodexModels(
      options.output ? resolvePath(options.output) : undefined,
    );
    console.log(
      `Synced ${String(result.modelCount)} models to ${result.targetPath}`,
    );
  });

const setup = program.command("setup").description("Configure a client");

setup
  .command("codex")
  .description("Configure Codex CLI profile or Codex Desktop global settings")
  .option("--default-model <id>", "optional initial model; use /model later")
  .option("--model <id>", "deprecated alias for --default-model")
  .option("--catalog <path>", "Codex model catalog output path")
  .option("--scope <scope>", "profile or global", "profile")
  .option("-p, --port <number>", "adapter port", "4141")
  .option("--binary <path>", "absolute installed copilot-harness path")
  .option("--remove", "restore the exact pre-setup configuration")
  .action(
    async (options: {
      model?: string;
      defaultModel?: string;
      catalog?: string;
      scope: string;
      port: string;
      binary?: string;
      remove?: boolean;
    }) => {
      if (options.scope !== "profile" && options.scope !== "global") {
        throw new Error("scope must be profile or global");
      }
      const target = defaultCodexPath(options.scope);
      if (options.remove) {
        console.log(
          (await restoreClientSetup(target))
            ? `Restored ${target}`
            : `No backup for ${target}`,
        );
        return;
      }
      const catalogPath = options.catalog
        ? resolvePath(options.catalog)
        : defaultCodexCatalogPath();
      const synced = await syncCodexModels(catalogPath);
      const defaultModel = selectedDefaultModel(options);
      const result = await setupCodex({
        scope: options.scope,
        binaryPath: adapterBinaryPath(options.binary),
        port: parsePort(options.port),
        ...(defaultModel ? { model: defaultModel } : {}),
        catalogPath: synced.targetPath,
      });
      console.log(
        `Configured ${result.targetPath} with ${String(synced.modelCount)} selectable models`,
      );
    },
  );

setup
  .command("claude-cli")
  .description("Configure Claude Code CLI")
  .option(
    "--default-model <id>",
    "optional initial Claude model; use /model later",
  )
  .option("--model <id>", "deprecated alias for --default-model")
  .option("-p, --port <number>", "adapter port", "4141")
  .option("--binary <path>", "absolute installed copilot-harness path")
  .option("--remove", "restore the exact pre-setup configuration")
  .action(
    async (options: {
      model?: string;
      defaultModel?: string;
      port: string;
      binary?: string;
      remove?: boolean;
    }) => {
      const target = defaultClaudeCliPath();
      if (options.remove) {
        console.log(
          (await restoreClientSetup(target))
            ? `Restored ${target}`
            : `No backup for ${target}`,
        );
        return;
      }
      const defaultModel = selectedDefaultModel(options);
      const result = await setupClaudeCli({
        binaryPath: adapterBinaryPath(options.binary),
        port: parsePort(options.port),
        ...(defaultModel ? { model: defaultModel } : {}),
      });
      console.log(`Configured ${result.targetPath}`);
    },
  );

setup
  .command("claude-vscode")
  .description("Configure the Claude Code VS Code extension")
  .option(
    "--default-model <id>",
    "optional initial Claude model; use /model later",
  )
  .option("--model <id>", "deprecated alias for --default-model")
  .option("-p, --port <number>", "adapter port", "4141")
  .option("--remove", "restore the exact pre-setup configuration")
  .action(
    async (options: {
      model?: string;
      defaultModel?: string;
      port: string;
      remove?: boolean;
    }) => {
      const target = defaultClaudeVsCodePath();
      if (options.remove) {
        console.log(
          (await restoreClientSetup(target))
            ? `Restored ${target}`
            : `No backup for ${target}`,
        );
        return;
      }
      const defaultModel = selectedDefaultModel(options);
      const result = await setupClaudeVsCode({
        token: await getOrCreateToken(),
        port: parsePort(options.port),
        ...(defaultModel ? { model: defaultModel } : {}),
      });
      console.log(`Configured ${result.targetPath}; reload the VS Code window`);
    },
  );

setup
  .command("claude-desktop")
  .description("Print the Claude Desktop gateway fields")
  .option("-p, --port <number>", "adapter port", "4141")
  .action((options: { port: string }) => {
    const port = parsePort(options.port);
    console.log("Provider: Gateway");
    console.log(`Base URL: http://127.0.0.1:${String(port)}`);
    console.log("Credential kind: Static API key");
    console.log("Auth scheme: Bearer");
    console.log("API key: run `copilot-harness token`");
  });

program.parseAsync().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
