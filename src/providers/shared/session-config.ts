import type {
  SessionConfig,
  MCPServerConfig,
  PermissionRequestResult,
  SystemMessageAppendConfig,
} from "@github/copilot-sdk";
import { BuiltInTools, ToolSet } from "@github/copilot-sdk";

type Hooks = NonNullable<SessionConfig["hooks"]>;
type PreToolUseResult = NonNullable<
  Awaited<NonNullable<ReturnType<NonNullable<Hooks["onPreToolUse"]>>>>
>;
type ErrorResult = NonNullable<
  Awaited<NonNullable<ReturnType<NonNullable<Hooks["onErrorOccurred"]>>>>
>;
import type { ServerConfig, ApprovalRule } from "#config.js";
import type { Logger } from "#logger.js";
import { isIsolatedTool, validateToolArguments } from "#security.js";

type SdkReasoningEffort = NonNullable<SessionConfig["reasoningEffort"]>;

// The runtime catalog can advertise values newer than the SDK declaration
// (for example "none" or "max"), so cast only after catalog validation.
export function toSdkEffort(effort: string): SdkReasoningEffort {
  return effort as SdkReasoningEffort;
}

export interface SessionConfigOptions {
  model: string;
  systemMessage?: string | undefined;
  logger: Logger;
  config: ServerConfig;
  reasoningEffort?: string | undefined;
  /** @deprecated Use reasoningEffort; retained for API compatibility. */
  supportsReasoningEffort?: boolean | undefined;
  cwd?: string | undefined;
  provider?: SessionConfig["provider"];
}

function buildAvailableTools(config: ServerConfig): string[] {
  const tools = new ToolSet()
    .addBuiltIn(BuiltInTools.Isolated)
    .addBuiltIn(config.allowedCliTools);
  if (Object.keys(config.mcpServers).length > 0) tools.addMcp("*");
  return tools.toArray();
}

function isApproved(rule: ApprovalRule, kind: string): boolean {
  if (typeof rule === "boolean") return rule;
  return rule.some((k) => k === kind);
}

export function createSessionConfig({
  model,
  systemMessage,
  logger,
  config,
  reasoningEffort,
  supportsReasoningEffort,
  cwd,
  provider,
}: SessionConfigOptions): SessionConfig {
  return {
    clientName: "copilot-adapter",
    model,
    streaming: true,
    includeSubAgentStreamingEvents: false,
    workingDirectory: cwd ?? process.cwd(),
    enableSessionTelemetry: false,
    enableConfigDiscovery: false,
    enableSkills: false,
    enableHostGitOperations: false,
    enableSessionStore: false,
    memory: { enabled: false },
    ...(provider && { provider }),

    ...(systemMessage && {
      systemMessage: {
        mode: "append",
        content: systemMessage,
      } satisfies SystemMessageAppendConfig,
    }),

    mcpServers: Object.fromEntries(
      Object.entries(config.mcpServers).map(([name, server]) => [
        name,
        { ...server, tools: ["*"] } satisfies MCPServerConfig,
      ]),
    ),

    availableTools: buildAvailableTools(config),
    ...((reasoningEffort ??
      (supportsReasoningEffort ? config.reasoningEffort : undefined)) && {
      reasoningEffort: toSdkEffort(
        reasoningEffort ?? (config.reasoningEffort as string),
      ),
    }),

    onUserInputRequest: (request) => {
      logger.debug(`User input requested: "${request.question}"`);
      return Promise.resolve({
        answer:
          "Interactive input is not available here. Ask the user directly in your reply instead, presenting any choices as a short numbered list.",
        wasFreeform: true,
      });
    },

    onPermissionRequest: (request) => {
      const approved = isApproved(config.autoApprovePermissions, request.kind);
      logger.debug(
        `Permission "${request.kind}": ${approved ? "approved" : "denied"}`,
      );
      if (!approved) {
        return Promise.resolve({
          kind: "reject",
        } satisfies PermissionRequestResult);
      }
      // Hoist read/write/memory to session scope so the SDK stops asking again.
      // Other kinds (shell, mcp, url, custom-tool, hook) need payload data not
      // present on PermissionRequest, so we approve them per-call.
      switch (request.kind) {
        case "read":
        case "write":
        case "memory":
          return Promise.resolve({
            kind: "approve-for-session",
            approval: { kind: request.kind },
          } satisfies PermissionRequestResult);
        default:
          return Promise.resolve({
            kind: "approve-once",
          } satisfies PermissionRequestResult);
      }
    },

    hooks: {
      onPreToolUse: async (input) => {
        const toolName = input.toolName;

        if (
          isIsolatedTool(toolName) ||
          config.allowedCliTools.includes("*") ||
          config.allowedCliTools.includes(toolName)
        ) {
          try {
            if (!isIsolatedTool(toolName)) {
              await validateToolArguments(cwd ?? process.cwd(), input.toolArgs);
            }
          } catch (error) {
            logger.warn(
              `Tool "${toolName}" denied: ${error instanceof Error ? error.message : String(error)}`,
            );
            return { permissionDecision: "deny" } satisfies PreToolUseResult;
          }
          logger.debug(`Tool "${toolName}": allowed`);
          return Promise.resolve({
            permissionDecision: "allow",
          } satisfies PreToolUseResult);
        }

        for (const [serverName, server] of Object.entries(config.mcpServers)) {
          const allowlist = server.allowedTools ?? [];
          if (allowlist.includes("*") || allowlist.includes(toolName)) {
            logger.debug(`Tool "${toolName}": allowed (${serverName})`);
            return Promise.resolve({
              permissionDecision: "allow",
            } satisfies PreToolUseResult);
          }
        }

        logger.debug(`Tool "${toolName}": denied (not in any allowlist)`);
        return Promise.resolve({
          permissionDecision: "deny",
        } satisfies PreToolUseResult);
      },

      onPostToolUse: (input) => {
        logger.debug(`Tool executed: ${input.toolName}`);
      },

      onErrorOccurred: (input) => {
        const error =
          typeof input.error === "string"
            ? input.error
            : JSON.stringify(input.error);
        logger.warn(
          `SDK error (${input.errorContext}, ${input.recoverable ? "recoverable" : "not recoverable"}): ${error}`,
        );
        if (
          input.recoverable &&
          (input.errorContext === "model_call" ||
            input.errorContext === "tool_execution")
        ) {
          return {
            errorHandling: "retry",
            retryCount: 2,
          } satisfies ErrorResult;
        }
        return undefined;
      },
    },
  };
}
