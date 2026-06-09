import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Message, EndpointType, ModelConfig, ChatSession, TokenUsage } from "../types";

const STORAGE_KEY = "chat-sessions";
const ACTIVE_SESSION_KEY = "chat-active-session";

function createDefaultSession(): ChatSession {
  return {
    id: `session-${Date.now()}`,
    name: "Prompt 1",
    messages: [],
    createdAt: Date.now(),
  };
}

function loadChatSessions(): ChatSession[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as ChatSession[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to load chat sessions:", e);
  }
  return [createDefaultSession()];
}

function loadActiveSessionId(sessions: ChatSession[]): string {
  try {
    const saved = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (saved && sessions.some((s) => s.id === saved)) {
      return saved;
    }
  } catch (e) {
    console.error("Failed to load active chat session:", e);
  }
  return sessions[0]?.id ?? "";
}

interface ChatOptions {
  model: ModelConfig;
  endpoint: EndpointType;
  apiKey: string;
  projectId: string;
  use1MContext?: boolean;
  useMemory?: boolean;
  useGrounding?: boolean;
  thinkingLevel?: string;
  includeThoughts?: boolean;
  customUrl?: string;
  customLogin?: string;
  customPassword?: string;
}

interface GenerateImageOptions {
  prompt: string;
  apiKey: string;
  editImage?: string;
  editImageMimeType?: string;
  modelId?: string;
  searchMode?: string;
}

interface ChatResponse {
  content: string;
  rawJson: string;
  inputTokens: number;
  outputTokens: number;
}

let initialChatState: { sessions: ChatSession[]; activeSessionId: string } | undefined;

function getInitialChatState(): { sessions: ChatSession[]; activeSessionId: string } {
  if (!initialChatState) {
    const sessions = loadChatSessions();
    initialChatState = { sessions, activeSessionId: loadActiveSessionId(sessions) };
  }
  return initialChatState;
}

export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>(
    () => getInitialChatState().sessions
  );
  const [activeSessionId, setActiveSessionId] = useState<string>(
    () => getInitialChatState().activeSessionId
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null);
  const [lastRawJson, setLastRawJson] = useState<string | null>(null);
  const [totalTokens, setTotalTokens] = useState<{ input: number; output: number }>({ input: 0, output: 0 });
  const cancelledRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    }
  }, [activeSessionId]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages || [];

  const sendMessage = useCallback(async (
    prompt: string,
    options: ChatOptions,
    attachedFile?: { path: string; data: string; mimeType: string }
  ) => {
    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);

    const userMessage: Message = { role: "user", content: prompt };

    setSessions(prev => prev.map(s =>
      s.id === activeSessionId
        ? { ...s, messages: [...s.messages, userMessage] }
        : s
    ));

    try {
      const response = await invoke<ChatResponse>("send_chat_message", {
        prompt,
        history: messages,
        modelId: options.model.modelId,
        aiStudioModelId: options.model.aiStudioModelId,
        publisher: options.model.publisher,
        endpoint: options.endpoint,
        apiKey: options.apiKey,
        projectId: options.projectId,
        use1mContext: options.use1MContext || false,
        useMemory: options.useMemory || false,
        useGrounding: options.useGrounding || false,
        thinkingLevel: options.thinkingLevel,
        includeThoughts: options.includeThoughts ?? true,
        customUrl: options.customUrl,
        customLogin: options.customLogin,
        customPassword: options.customPassword,
        attachedFile,
      });

      // If cancelled, don't update with the response
      if (cancelledRef.current) {
        return;
      }

      const assistantMessage: Message = { role: "assistant", content: response.content };

      setSessions(prev => prev.map(s =>
        s.id === activeSessionId
          ? { ...s, messages: [...s.messages, assistantMessage] }
          : s
      ));

      setLastTokenUsage({ inputTokens: response.inputTokens, outputTokens: response.outputTokens });
      setLastRawJson(response.rawJson);
      setTotalTokens(prev => ({
        input: prev.input + response.inputTokens,
        output: prev.output + response.outputTokens,
      }));

      return response.content;
    } catch (e) {
      console.error("sendMessage ERROR:", e);
      if (!cancelledRef.current) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Setting error:", errorMsg);
        setError(errorMsg);
      }
    } finally {
      setIsLoading(false);
    }
  }, [messages, activeSessionId]);

  const generateImage = useCallback(async (options: GenerateImageOptions) => {
    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);

    try {
      const imageBase64 = await invoke<string>("generate_image", {
        prompt: options.prompt,
        apiKey: options.apiKey,
        editImage: options.editImage,
        editImageMimeType: options.editImageMimeType,
        modelId: options.modelId,
        searchMode: options.searchMode,
      });

      if (cancelledRef.current) {
        return;
      }

      setGeneratedImages(prev => [...prev, imageBase64]);
      return imageBase64;
    } catch (e) {
      if (!cancelledRef.current) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError(errorMsg);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveImage = useCallback(async (imageBase64: string, filename: string) => {
    try {
      await invoke("save_image", { imageBase64, filename });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      throw e;
    }
  }, []);

  const clearMessages = useCallback(() => {
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId
        ? { ...s, messages: [] }
        : s
    ));
    setError(null);
    setLastTokenUsage(null);
    setLastRawJson(null);
  }, [activeSessionId]);

  const clearImages = useCallback(() => {
    setGeneratedImages([]);
  }, []);

  const createSession = useCallback(() => {
    const newId = String(Date.now());
    const newSession: ChatSession = {
      id: newId,
      name: `Prompt ${sessions.length + 1}`,
      messages: [],
      createdAt: Date.now(),
    };
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newId);
    setLastTokenUsage(null);
    setLastRawJson(null);
  }, [sessions.length]);

  const deleteSession = useCallback((id: string) => {
    if (sessions.length <= 1) return;

    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining[0]?.id || "1");
    }
  }, [sessions, activeSessionId]);

  const renameSession = useCallback((id: string, name: string) => {
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, name } : s
    ));
  }, []);

  const stopGeneration = useCallback(() => {
    cancelledRef.current = true;
    setIsLoading(false);
    setError("Generation stopped by user");
  }, []);

  const deleteImage = useCallback((index: number) => {
    setGeneratedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  return {
    messages,
    sessions,
    activeSessionId,
    setActiveSessionId,
    isLoading,
    error,
    generatedImages,
    lastTokenUsage,
    lastRawJson,
    totalTokens,
    sendMessage,
    generateImage,
    saveImage,
    clearMessages,
    clearImages,
    deleteImage,
    createSession,
    deleteSession,
    renameSession,
    stopGeneration,
    setError,
  };
}
