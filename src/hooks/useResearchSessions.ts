import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ResearchSession } from "../types";
import {
    DeepResearchOptions,
    DeepResearchResponse,
    ResearchImage,
} from "../lib/deepResearch";

export interface ResearchTask {
    id: string;
    sessionId: string;
    query: string;
    status: "running" | "plan_ready" | "completed" | "failed" | "cancelled";
    result?: string;
    images?: ResearchImage[];
    error?: string;
    startedAt: number;
    completedAt?: number;
    interactionId?: string;
    agent?: string;
    timeoutMinutes?: number;
}

const STORAGE_KEY = "research-sessions";

function generateSessionId() {
    return `research-session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createDefaultSession(): ResearchSession {
    return {
        id: generateSessionId(),
        name: "Research 1",
        createdAt: Date.now(),
    };
}

function applyResponse(response: DeepResearchResponse): Partial<ResearchTask> {
    if (response.isPlan) {
        return {
            status: "plan_ready",
            result: response.content,
            images: response.images,
            interactionId: response.interactionId,
            completedAt: Date.now(),
        };
    }
    return {
        status: "completed",
        result: response.content,
        images: response.images,
        interactionId: response.interactionId,
        completedAt: Date.now(),
    };
}

export function useResearchSessions() {
    const [sessions, setSessions] = useState<ResearchSession[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error("Failed to load research sessions:", e);
        }
        return [createDefaultSession()];
    });

    const [activeSessionId, setActiveSessionId] = useState<string>(() => {
        return sessions[0]?.id || "";
    });

    const [tasks, setTasks] = useState<ResearchTask[]>(() => {
        try {
            const saved = localStorage.getItem(`${STORAGE_KEY}-tasks`);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.error("Failed to load research tasks:", e);
        }
        return [];
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    }, [sessions]);

    useEffect(() => {
        localStorage.setItem(`${STORAGE_KEY}-tasks`, JSON.stringify(tasks));
    }, [tasks]);

    const createSession = useCallback(() => {
        const newSession: ResearchSession = {
            id: generateSessionId(),
            name: `Research ${sessions.length + 1}`,
            createdAt: Date.now(),
        };
        setSessions((prev) => [...prev, newSession]);
        setActiveSessionId(newSession.id);
    }, [sessions.length]);

    const deleteSession = useCallback(
        (id: string) => {
            if (sessions.length <= 1) return;

            setSessions((prev) => prev.filter((s) => s.id !== id));
            setTasks((prev) => prev.filter((t) => t.sessionId !== id));

            if (activeSessionId === id) {
                const remaining = sessions.filter((s) => s.id !== id);
                setActiveSessionId(remaining[0]?.id || "");
            }
        },
        [sessions, activeSessionId]
    );

    const renameSession = useCallback((id: string, name: string) => {
        setSessions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, name } : s))
        );
    }, []);

    const runResearch = useCallback(
        (taskId: string, options: DeepResearchOptions) => {
            invoke<DeepResearchResponse>("deep_research", { options })
                .then((response) => {
                    const updates = applyResponse(response);
                    setTasks((prev) =>
                        prev.map((t) =>
                            t.id === taskId &&
                            (t.status === "running" || t.status === "plan_ready")
                                ? { ...t, ...updates }
                                : t
                        )
                    );
                })
                .catch((error) => {
                    const errorMsg =
                        error instanceof Error ? error.message : String(error);
                    setTasks((prev) =>
                        prev.map((t) =>
                            t.id === taskId &&
                            (t.status === "running" || t.status === "plan_ready")
                                ? {
                                      ...t,
                                      status: "failed" as const,
                                      error: errorMsg,
                                      completedAt: Date.now(),
                                  }
                                : t
                        )
                    );
                });
        },
        []
    );

    const startResearch = useCallback(
        async (options: DeepResearchOptions) => {
            const taskId = `research-${Date.now()}`;

            setTasks((prev) => [
                ...prev,
                {
                    id: taskId,
                    sessionId: activeSessionId,
                    query: options.prompt,
                    status: "running",
                    startedAt: Date.now(),
                    agent: options.agent,
                    timeoutMinutes: options.timeoutMinutes,
                },
            ]);

            runResearch(taskId, options);
            return taskId;
        },
        [activeSessionId, runResearch]
    );

    const continueResearch = useCallback(
        async (
            taskId: string,
            prompt: string,
            collaborativePlanning: boolean,
            options: Omit<
                DeepResearchOptions,
                "prompt" | "previousInteractionId" | "collaborativePlanning"
            >
        ) => {
            const task = tasks.find((t) => t.id === taskId);
            if (!task?.interactionId) return;

            setTasks((prev) =>
                prev.map((t) =>
                    t.id === taskId
                        ? {
                              ...t,
                              status: "running" as const,
                              error: undefined,
                              result: undefined,
                              images: undefined,
                              completedAt: undefined,
                          }
                        : t
                )
            );

            runResearch(taskId, {
                ...options,
                prompt,
                previousInteractionId: task.interactionId,
                collaborativePlanning,
            });
        },
        [tasks, runResearch]
    );

    const cancelTask = useCallback((taskId: string) => {
        setTasks((prev) =>
            prev.map((t) =>
                t.id === taskId &&
                (t.status === "running" || t.status === "plan_ready")
                    ? {
                          ...t,
                          status: "cancelled" as const,
                          error: "Cancelled by user",
                          completedAt: Date.now(),
                      }
                    : t
            )
        );
    }, []);

    const dismissTask = useCallback((taskId: string) => {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
    }, []);

    const clearCompleted = useCallback(() => {
        setTasks((prev) =>
            prev.filter(
                (t) =>
                    t.sessionId !== activeSessionId ||
                    t.status === "running" ||
                    t.status === "plan_ready"
            )
        );
    }, [activeSessionId]);

    const sessionTasks = tasks.filter((t) => t.sessionId === activeSessionId);
    const runningTasks = sessionTasks.filter((t) => t.status === "running");
    const completedTasks = sessionTasks.filter(
        (t) => t.status !== "running"
    );

    return {
        sessions,
        activeSessionId,
        setActiveSessionId,
        createSession,
        deleteSession,
        renameSession,
        tasks: sessionTasks,
        runningTasks,
        completedTasks,
        startResearch,
        continueResearch,
        cancelTask,
        dismissTask,
        clearCompleted,
    };
}