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
  | { ok: true; model: string; reasoningEffort?: string | undefined }
  | { ok: false; error: string };

export async function resolveModelForSession(
  service: CopilotService,
  requestedModel: string,
  config: { reasoningEffort?: ReasoningEffort | undefined },
  logger: Logger,
  requestedEffort?: string,
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

    const modelInfo = models.find((m) => m.id === match.model);
    const reasoningEffort = requestedEffort ?? config.reasoningEffort;
    if (reasoningEffort) {
      const supported = modelInfo?.supportedReasoningEfforts ?? [];
      if (!supported.some((effort) => effort === reasoningEffort)) {
        if (requestedEffort) {
          return {
            ok: false,
            error:
              supported.length > 0
                ? `Model "${match.model}" does not support reasoning effort "${reasoningEffort}". Supported efforts: ${supported.join(", ")}`
                : `Model "${match.model}" does not support configurable reasoning effort`,
          };
        }
        logger.debug(
          `Model "${match.model}" does not support configured reasoning effort "${reasoningEffort}", ignoring config`,
        );
        return { ok: true, model: match.model };
      }
    }

    return {
      ok: true,
      model: match.model,
      ...(reasoningEffort && { reasoningEffort }),
    };
  } catch (err) {
    if (requestedEffort) {
      logger.warn(
        "Failed to list models while validating reasoning effort:",
        err,
      );
      return {
        ok: false,
        error: `Unable to validate reasoning effort "${requestedEffort}" because the Copilot model catalog is unavailable`,
      };
    }
    logger.warn("Failed to list models, passing model through as-is:", err);
    return { ok: true, model: requestedModel };
  }
}
