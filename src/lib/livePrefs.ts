import type { LiveSessionMode } from "./languages";
import { normalizeLanguageId } from "./languages";

export interface LiveSessionPrefs {
  sessionMode: LiveSessionMode;
  targetLanguage: string;
  customInstruction: string;
}

const STORAGE_KEY = "live-session-prefs";

const DEFAULTS: LiveSessionPrefs = {
  sessionMode: "translate",
  targetLanguage: "en",
  customInstruction: "",
};

function normalizeMode(mode: string | undefined): LiveSessionMode {
  if (mode === "conversation") return "conversation";
  if (mode === "bidirectional") return "bidirectional";
  return "translate";
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
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLivePrefs(prefs: LiveSessionPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}