import type { LiveSessionMode } from "./languages";

export interface LiveSessionPrefs {
  sessionMode: LiveSessionMode;
  sourceLanguage: string;
  targetLanguage: string;
  customInstruction: string;
}

const STORAGE_KEY = "live-session-prefs";

const DEFAULTS: LiveSessionPrefs = {
  sessionMode: "translate",
  sourceLanguage: "auto",
  targetLanguage: "en",
  customInstruction: "",
};

export function loadLivePrefs(): LiveSessionPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LiveSessionPrefs>;
    return {
      sessionMode: parsed.sessionMode ?? DEFAULTS.sessionMode,
      sourceLanguage: parsed.sourceLanguage ?? DEFAULTS.sourceLanguage,
      targetLanguage: parsed.targetLanguage ?? DEFAULTS.targetLanguage,
      customInstruction: parsed.customInstruction ?? DEFAULTS.customInstruction,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLivePrefs(prefs: LiveSessionPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}