import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "#server.js";
import type { AppContext } from "#context.js";
import type { Provider } from "#providers/types.js";
import { Logger } from "#logger.js";
import { Stats } from "#stats.js";

const noopProvider: Provider = {
  name: "test",
  routes: [],
  register() {},
};

const TEST_TOKEN = "local-secret";
const authHeaders = { authorization: `Bearer ${TEST_TOKEN}` };

function createCtx(pingImpl: AppContext["service"]["ping"]): AppContext {
  return {
    service: { ping: pingImpl } as unknown as AppContext["service"],
    logger: new Logger("none"),
    config: {
      mcpServers: {},
      allowedCliTools: [],
      bodyLimit: 10 * 1024 * 1024,
      requestTimeoutMs: 0,
      autoApprovePermissions: true,
    },
    port: 0,
    stats: new Stats(),
  };
}

describe("GET /health", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 with status ok when ping succeeds", async () => {
    const ctx = createCtx(() =>
      Promise.resolve({ message: "health", timestamp: "1000" }),
    );
    app = await createServer(ctx, noopProvider, TEST_TOKEN);

    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      message: "health",
      timestamp: "1000",
    });
  });

  it("returns 503 with error message when ping fails", async () => {
    const ctx = createCtx(() => Promise.reject(new Error("connection lost")));
    app = await createServer(ctx, noopProvider, TEST_TOKEN);

    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", message: "connection lost" });
  });

  it("returns 503 with fallback message for non-Error throws", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const ctx = createCtx(() => Promise.reject("something"));
    app = await createServer(ctx, noopProvider, TEST_TOKEN);

    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", message: "Unknown error" });
  });

  it("requires the configured bearer token", async () => {
    const ctx = createCtx(() =>
      Promise.resolve({ message: "health", timestamp: "1000" }),
    );
    app = await createServer(ctx, noopProvider, TEST_TOKEN);

    const denied = await app.inject({ method: "GET", url: "/health" });
    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: "Bearer local-secret" },
    });

    expect(denied.statusCode).toBe(401);
    expect(allowed.statusCode).toBe(200);
  });

  it("accepts x-api-key for Claude model discovery", async () => {
    const ctx = createCtx(() =>
      Promise.resolve({ message: "health", timestamp: "1000" }),
    );
    app = await createServer(ctx, noopProvider, TEST_TOKEN);

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-api-key": "local-secret" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("reloads a rotated token without restarting", async () => {
    const ctx = createCtx(() =>
      Promise.resolve({ message: "health", timestamp: "1000" }),
    );
    let token = "first-secret";
    app = await createServer(ctx, noopProvider, () => Promise.resolve(token));

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/health",
          headers: { authorization: "Bearer first-secret" },
        })
      ).statusCode,
    ).toBe(200);
    token = "second-secret";
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/health",
          headers: { authorization: "Bearer first-secret" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/health",
          headers: { "x-api-key": "second-secret" },
        })
      ).statusCode,
    ).toBe(200);
  });
});
