import type { ServerConfig } from "#config.js";

export const POLICY_NAMES = [
  "chat",
  "read-only",
  "workspace-write",
  "unsafe-shell",
  "unsafe-all",
] as const;

export type PolicyName = (typeof POLICY_NAMES)[number];

const PRESETS = {
  chat: {
    tools: [],
    permissions: false,
    mcp: false,
  },
  "read-only": {
    tools: ["glob", "grep", "view"],
    permissions: ["read"],
    mcp: false,
  },
  "workspace-write": {
    tools: ["glob", "grep", "view", "edit", "create"],
    permissions: ["read", "write"],
    mcp: false,
  },
  "unsafe-shell": {
    tools: ["glob", "grep", "view", "edit", "create", "bash"],
    permissions: ["read", "write", "shell"],
    mcp: false,
  },
  "unsafe-all": {
    tools: ["glob", "grep", "view", "edit", "create", "bash"],
    permissions: ["read", "write", "shell", "mcp"],
    mcp: true,
  },
} as const satisfies Record<
  PolicyName,
  {
    tools: readonly string[];
    permissions: false | readonly string[];
    mcp: boolean;
  }
>;

export function parsePolicy(value: string): PolicyName {
  if (POLICY_NAMES.includes(value as PolicyName)) return value as PolicyName;
  throw new Error(
    `Invalid policy "${value}". Expected one of: ${POLICY_NAMES.join(", ")}`,
  );
}

export function applyPolicy(
  config: ServerConfig,
  policy: PolicyName,
): ServerConfig {
  const preset = PRESETS[policy];
  return {
    ...config,
    allowedCliTools: [...preset.tools],
    mcpServers: preset.mcp ? config.mcpServers : {},
    autoApprovePermissions:
      preset.permissions === false ? false : [...preset.permissions],
  } as ServerConfig;
}
