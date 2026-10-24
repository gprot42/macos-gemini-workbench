import { MODELS } from "../models";
import { EndpointType } from "../types";

const DEFAULT_MODEL_ID = "claude-opus-4-8";
const DEFAULT_ENDPOINT: EndpointType = "vertex_ai";
const AI_STUDIO_FALLBACK_MODEL_ID = "gemini-3-7-flash";

/** Retired model IDs mapped onto current replacements. */
const MODEL_ID_ALIASES: Record<string, string> = {
  "grok-4-1": "grok-4-6",
  "grok-4": "grok-4-6",
  "grok-3": "grok-4-6",
  "grok-3-fast": "grok-4-6",
  "grok-3-mini": "grok-4-6",
};

export function resolveModelId(modelId: string | undefined): string {
  if (modelId && MODELS[modelId]) {
    return modelId;
  }
  if (modelId) {
    const aliased = MODEL_ID_ALIASES[modelId];
    if (aliased && MODELS[aliased]) {
      return aliased;
    }
  }
  return DEFAULT_MODEL_ID;
}

/** Model to use on AI Studio when Vertex AI is unavailable (no service account). */
export function resolveAiStudioModelId(modelId: string): string {
  if (MODELS[modelId]?.endpointSupport.includes("ai_studio")) {
    return modelId;
  }
  return AI_STUDIO_FALLBACK_MODEL_ID;
}

export function resolveEndpoint(
  endpoint: string | undefined,
  modelId: string
): EndpointType {
  const model = MODELS[modelId];
  const candidate = endpoint as EndpointType;
  if (model?.endpointSupport.includes(candidate)) {
    return candidate;
  }
  return model?.endpointSupport[0] ?? DEFAULT_ENDPOINT;
}