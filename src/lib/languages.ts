export const STT_LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "ja-JP", label: "Japanese" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "ko-KR", label: "Korean" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "it-IT", label: "Italian" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ar-SA", label: "Arabic" },
  { code: "ru-RU", label: "Russian" },
  { code: "th-TH", label: "Thai" },
  { code: "vi-VN", label: "Vietnamese" },
] as const;

export const TRANSLATION_LANGUAGES = [
  { id: "auto", label: "Auto-detect" },
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese" },
  { id: "hi", label: "Hindi" },
  { id: "ar", label: "Arabic" },
  { id: "ru", label: "Russian" },
  { id: "th", label: "Thai" },
  { id: "vi", label: "Vietnamese" },
] as const;

export type LiveSessionMode = "conversation" | "translate" | "bidirectional";

export function languageLabel(id: string): string {
  return TRANSLATION_LANGUAGES.find((l) => l.id === id)?.label ?? id;
}

export function buildTranslationInstruction(
  mode: LiveSessionMode,
  sourceId: string,
  targetId: string,
  custom?: string
): string | undefined {
  if (mode === "conversation") return custom?.trim() || undefined;

  if (custom?.trim()) return custom.trim();

  const target = languageLabel(targetId);

  if (mode === "bidirectional") {
    const langA = languageLabel(sourceId === "auto" ? "en" : sourceId);
    const langB = target;
    return (
      `You are a real-time bidirectional interpreter. ` +
      `When the user speaks ${langA}, respond only in ${langB} with a spoken translation. ` +
      `When the user speaks ${langB}, respond only in ${langA} with a spoken translation. ` +
      `Do not add commentary or answer questions—only translate. Keep responses concise.`
    );
  }

  const source =
    sourceId === "auto"
      ? "the user's language (auto-detect)"
      : languageLabel(sourceId);

  return (
    `You are a real-time interpreter. The user speaks in ${source}. ` +
    `Respond only in ${target}. Translate what they say accurately and speak the translation aloud. ` +
    `Do not add commentary, explanations, or answer questions—only provide the translation. ` +
    `Keep responses concise.`
  );
}