export interface McpServerConfig {
  name: string;
  url: string;
  authToken?: string;
}

export interface ResearchAttachment {
  data: string;
  mimeType: string;
  name?: string;
}

export interface ResearchImage {
  mimeType: string;
  data: string;
}

export interface DeepResearchOptions {
  prompt: string;
  apiKey: string;
  timeoutMinutes?: number;
  agent?: string;
  previousInteractionId?: string;
  collaborativePlanning?: boolean;
  visualization?: boolean;
  fileSearchStoreNames?: string[];
  mcpServers?: McpServerConfig[];
  attachments?: ResearchAttachment[];
}

export interface DeepResearchResponse {
  content: string;
  images: ResearchImage[];
  interactionId: string;
  isPlan: boolean;
  rawJson: string;
}

export const DEEP_RESEARCH_AGENTS = {
  standard: "deep-research-preview-04-2026",
  max: "deep-research-max-preview-04-2026",
} as const;

export type DeepResearchAgentMode = keyof typeof DEEP_RESEARCH_AGENTS;

export interface DeepResearchPrefs {
  agentMode: DeepResearchAgentMode;
  timeoutMinutes: number;
  collaborativePlanning: boolean;
  visualization: boolean;
  fileSearchStoreName: string;
}

const PREFS_KEY = "deep-research-prefs";

const DEFAULT_PREFS: DeepResearchPrefs = {
  agentMode: "standard",
  timeoutMinutes: 60,
  collaborativePlanning: false,
  visualization: false,
  fileSearchStoreName: "",
};

export function loadDeepResearchPrefs(): DeepResearchPrefs {
  try {
    const saved = localStorage.getItem(PREFS_KEY);
    if (saved) {
      return { ...DEFAULT_PREFS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error("Failed to load deep research prefs:", e);
  }
  return DEFAULT_PREFS;
}

export function saveDeepResearchPrefs(prefs: DeepResearchPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}