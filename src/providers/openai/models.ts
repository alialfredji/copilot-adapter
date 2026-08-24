import type { FastifyRequest, FastifyReply } from "fastify";
import type { AppContext } from "#context.js";
import { currentTimestamp } from "#providers/openai/schemas.js";
import { sendOpenAIError } from "#providers/shared/errors.js";

function familyTier(id: string): string | undefined {
  const normalized = id.toLowerCase();
  if (!normalized.includes("claude") && !normalized.includes("anthropic")) {
    return undefined;
  }
  if (normalized.includes("haiku")) return "haiku";
  if (normalized.includes("opus")) return "opus";
  return "sonnet";
}

export function createModelsHandler({ service, logger }: AppContext) {
  return async function handleModels(
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const models = await service.listModels();

      const enabledModels = models.filter(
        (model) => model.policy?.state !== "disabled",
      );
      const data = enabledModels.map((model) => {
        const tier = familyTier(model.id);
        return {
          id: model.id,
          name: model.name,
          display_name: model.name,
          object: "model" as const,
          type: "model" as const,
          created: currentTimestamp(),
          created_at: new Date().toISOString(),
          owned_by: "github-copilot",
          ...(tier && { anthropic_family_tier: tier }),
        };
      });
      const response = {
        object: "list",
        data,
        has_more: false,
        first_id: data[0]?.id ?? null,
        last_id: data.at(-1)?.id ?? null,
      };

      reply.send(response);
    } catch (err) {
      logger.error("Couldn't fetch models:", err);
      sendOpenAIError(reply, 500, "api_error", "Failed to list models");
    }
  };
}
