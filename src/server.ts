import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { timingSafeEqual } from "node:crypto";
import type { AppContext } from "#context.js";
import type { LogLevel } from "#logger.js";
import type { Provider } from "#providers/types.js";
import { createModelsHandler } from "#providers/openai/models.js";

const PINO_LEVEL = {
  none: "silent",
  error: "error",
  warning: "warn",
  info: "info",
  debug: "debug",
  all: "trace",
} satisfies Record<LogLevel, string>;

export async function createServer(
  ctx: AppContext,
  provider: Provider,
  authToken: string | (() => Promise<string>),
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: ctx.config.bodyLimit,
    // Without this, shutdown hangs waiting for SSE streams to drain
    forceCloseConnections: true,
    logger: {
      level: PINO_LEVEL[ctx.logger.level],
    },
  });

  app.server.requestTimeout = ctx.config.requestTimeoutMs;

  await app.register(cors, {
    origin: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "anthropic-beta",
      "anthropic-version",
      "x-api-key",
    ],
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    const apiKeyHeader = request.headers["x-api-key"];
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    const supplied = bearer ?? apiKey;
    const expected = Buffer.from(
      typeof authToken === "string" ? authToken : await authToken(),
    );
    const actual = Buffer.from(supplied ?? "");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      await reply.status(401).send({
        error: {
          type: "authentication_error",
          message: "Invalid local adapter token",
        },
      });
    }
  });

  app.get("/health", async (_req, reply) => {
    try {
      const { message, timestamp, protocolVersion } =
        await ctx.service.ping("health");
      return await reply.send({
        status: "ok",
        message,
        timestamp,
        protocolVersion,
        ...(ctx.workspace && { workspace: ctx.workspace }),
        ...(ctx.policy && { policy: ctx.policy }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(503).send({ status: "error", message });
    }
  });

  app.head("/api/hello", async (_req, reply) => {
    await reply.status(204).send();
  });

  app.get("/v1/models", createModelsHandler(ctx));

  provider.register(app, ctx);

  return app;
}
