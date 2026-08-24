import type { ModelInfo } from "@github/copilot-sdk";
import type { CopilotService } from "#copilot-service.js";
import type { ReasoningEffort } from "#config.js";
import type { Logger } from "#logger.js";

export function normalizeModelId(id: string): string {
  return id.replace(/-\d{8}$/, "").replace(/\./g, "-");
}

export type ModelMatch = { ok: true; model: string } | { ok: false };

export function resolveModel(
  requestedModel: string,
  availableModels: ModelInfo[],
  logger?: Logger,
): ModelMatch {
  if (availableModels.some((m) => m.id === requestedModel)) {
    return { ok: true, model: requestedModel };
  }

  const normalizedRequest = normalizeModelId(requestedModel);
  const normalizedMatch = availableModels.find(
    (m) => normalizeModelId(m.id) === normalizedRequest,
  );
  if (normalizedMatch) {
    logger?.debug(
      `Model "${requestedModel}" resolved to "${normalizedMatch.id}" (normalized match)`,
    );
    return { ok: true, model: normalizedMatch.id };
  }

  return { ok: false };
}

export type ModelResolution =
  | { ok: true; model: string; supportsReasoningEffort: boolean }
  | { ok: false; error: string };

export async function resolveModelForSession(
  service: CopilotService,
  requestedModel: string,
  config: { reasoningEffort?: ReasoningEffort | undefined },
  logger: Logger,
): Promise<ModelResolution> {
  try {
    const models = await service.listModels();
    const match = resolveModel(requestedModel, models, logger);
    if (!match.ok) {
      return {
        ok: false,
        error: `Model "${requestedModel}" is not available. Available models: ${models.map((m) => m.id).join(", ")}`,
      };
    }

    let supportsReasoningEffort = false;
    if (config.reasoningEffort) {
      const modelInfo = models.find((m) => m.id === match.model);
      supportsReasoningEffort =
        modelInfo?.supportedReasoningEfforts?.some(
          (effort) => effort === config.reasoningEffort,
        ) ?? false;
      if (!supportsReasoningEffort) {
        logger.debug(
          `Model "${match.model}" does not support reasoning effort "${config.reasoningEffort}", ignoring config`,
        );
      }
    }

    return { ok: true, model: match.model, supportsReasoningEffort };
  } catch (err) {
    logger.warn("Failed to list models, passing model through as-is:", err);
    return { ok: true, model: requestedModel, supportsReasoningEffort: false };
  }
}
