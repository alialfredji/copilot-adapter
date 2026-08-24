import {
  CopilotClient,
  type CopilotSession,
  type SessionConfig,
  type ModelInfo,
  type GetAuthStatusResponse,
} from "@github/copilot-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { LogLevel, Logger } from "#logger.js";

export interface CopilotServiceOptions {
  logLevel?: LogLevel | undefined;
  logger?: Logger | undefined;
  cwd?: string | undefined;
  githubToken?: string | undefined;
}

const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;

function resolveGitHubToken(explicit?: string): string | undefined {
  const environmentToken =
    explicit ??
    process.env.COPILOT_GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_TOKEN;
  if (environmentToken) return environmentToken;

  const result = spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    timeout: 3000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const token = result.status === 0 ? result.stdout.trim() : "";
  return token || undefined;
}

export class CopilotService {
  readonly cwd: string;
  private client: CopilotClient;
  private logger: Logger | undefined;
  private cachedModels: ModelInfo[] | undefined;
  private cachedModelsAt = 0;

  constructor(options: CopilotServiceOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.logger = options.logger;
    const gitHubToken = resolveGitHubToken(options.githubToken);
    this.client = new CopilotClient({
      mode: "empty",
      baseDirectory: process.env.COPILOT_HOME ?? join(homedir(), ".copilot"),
      logLevel: options.logLevel ?? "error",
      workingDirectory: this.cwd,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          (e): e is [string, string] => e[1] != null,
        ),
      ),
      ...(gitHubToken && {
        gitHubToken,
        useLoggedInUser: false,
      }),
    });
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    const errors = await this.client.stop();
    if (errors.length > 0) {
      this.logger?.warn(
        `Copilot SDK reported ${String(errors.length)} shutdown error(s)`,
      );
    }
  }

  async forceStop(): Promise<void> {
    await this.client.forceStop();
  }

  async getAuthStatus(): Promise<GetAuthStatusResponse> {
    return this.client.getAuthStatus();
  }

  async ping(
    message?: string,
  ): Promise<{ message: string; timestamp: string; protocolVersion?: number }> {
    return this.client.ping(message);
  }

  async listModels(): Promise<ModelInfo[]> {
    if (
      this.cachedModels &&
      Date.now() - this.cachedModelsAt < MODEL_CACHE_TTL_MS
    ) {
      return this.cachedModels;
    }
    const models = await this.client.listModels();
    this.cachedModels = models;
    this.cachedModelsAt = Date.now();
    return models;
  }

  async createSession(config: SessionConfig): Promise<CopilotSession> {
    this.logger?.info("Creating session");
    return this.client.createSession(config);
  }
}
