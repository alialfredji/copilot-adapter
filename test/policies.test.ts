import { describe, expect, it } from "vitest";
import type { ServerConfig } from "#config.js";
import { applyPolicy, parsePolicy } from "#policies.js";

const base: ServerConfig = {
  mcpServers: {
    test: { type: "local", command: "node", args: ["server.js"] } as never,
  },
  allowedCliTools: ["*"],
  autoApprovePermissions: true,
  bodyLimit: 1024,
  requestTimeoutMs: 0,
};

describe("policy presets", () => {
  it("keeps read-only free from write and shell tools", () => {
    const config = applyPolicy(base, "read-only");
    expect(config.allowedCliTools).toEqual(["glob", "grep", "view"]);
    expect(config.autoApprovePermissions).toEqual(["read"]);
  });

  it("requires the explicitly unsafe profile for shell", () => {
    expect(applyPolicy(base, "workspace-write").allowedCliTools).not.toContain(
      "bash",
    );
    expect(applyPolicy(base, "unsafe-shell").allowedCliTools).toContain("bash");
  });

  it("disables MCP unless unsafe-all is explicitly selected", () => {
    expect(applyPolicy(base, "chat").mcpServers).toEqual({});
    expect(applyPolicy(base, "read-only").mcpServers).toEqual({});
    expect(applyPolicy(base, "workspace-write").mcpServers).toEqual({});
    expect(applyPolicy(base, "unsafe-shell").mcpServers).toEqual({});
    expect(applyPolicy(base, "unsafe-all").mcpServers).toEqual(base.mcpServers);
    expect(applyPolicy(base, "unsafe-all").autoApprovePermissions).toContain(
      "mcp",
    );
  });

  it("rejects unknown policies", () => {
    expect(() => parsePolicy("anything")).toThrow("Invalid policy");
  });
});
