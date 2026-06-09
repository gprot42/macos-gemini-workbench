import { MODELS } from "../models";
import { EndpointType } from "../types";

const DEFAULT_MODEL_ID = "claude-opus-4-8";
const DEFAULT_ENDPOINT: EndpointType = "vertex_ai";

export function resolveModelId(modelId: string | undefined): string {
  if (modelId && MODELS[modelId]) {
    return modelId;
  }
  return DEFAULT_MODEL_ID;
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