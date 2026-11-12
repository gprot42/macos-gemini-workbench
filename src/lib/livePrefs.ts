import type { LiveSessionMode } from "./languages";
import { normalizeLanguageId } from "./languages";

export type LiveConversationModelId =
  | "gemini-3.8-live"
  | "gemini-3.8-live-extended-thinking"
  | "gemini-3.1-flash-live-preview";

export type LiveThinkingLevel = "low" | "medium" | "high";

export interface LiveSessionPrefs {
  sessionMode: LiveSessionMode;
  targetLanguage: string;
  customInstruction: string;
  conversationModel: LiveConversationModelId;
  thinkingLevel: LiveThinkingLevel;
}

const STORAGE_KEY = "live-session-prefs";

const DEFAULTS: LiveSessionPrefs = {
  sessionMode: "translate",
  targetLanguage: "en",
  customInstruction: "",
  conversationModel: "gemini-3.8-live",
  thinkingLevel: "low",
};

function normalizeMode(mode: string | undefined): LiveSessionMode {
  if (mode === "conversation") return "conversation";
  if (mode === "bidirectional") return "bidirectional";
  return "translate";
}

function normalizeConversationModel(model: string | undefined): LiveConversationModelId {
  if (model === "gemini-3.8-live-extended-thinking") return model;
  if (model === "gemini-3.1-flash-live-preview") return model;
  return "gemini-3.8-live";
}

function normalizeThinkingLevel(level: string | undefined): LiveThinkingLevel {
  if (level === "medium" || level === "high") return level;
  return "low";
}

export function loadLivePrefs(): LiveSessionPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LiveSessionPrefs> & {
      sourceLanguage?: string;
    };
    return {
      sessionMode: normalizeMode(parsed.sessionMode),
      targetLanguage: normalizeLanguageId(parsed.targetLanguage ?? DEFAULTS.targetLanguage),
      customInstruction: parsed.customInstruction ?? DEFAULTS.customInstruction,
      conversationModel: normalizeConversationModel(parsed.conversationModel),
      thinkingLevel: normalizeThinkingLevel(parsed.thinkingLevel),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLivePrefs(prefs: LiveSessionPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
