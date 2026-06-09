import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DeepResearchOptions, DeepResearchResponse } from "../lib/deepResearch";

export interface ResearchTask {
    id: string;
    query: string;
    status: "running" | "plan_ready" | "completed" | "failed";
    result?: string;
    error?: string;
    startedAt: number;
    completedAt?: number;
    interactionId?: string;
}

export function useDeepResearch() {
    const [tasks, setTasks] = useState<ResearchTask[]>([]);

    const startResearch = useCallback(async (options: DeepResearchOptions) => {
        const taskId = `research-${Date.now()}`;

        setTasks(prev => [...prev, {
            id: taskId,
            query: options.prompt,
            status: "running",
            startedAt: Date.now(),
        }]);

        invoke<DeepResearchResponse>("deep_research", { options })
            .then(response => {
                setTasks(prev => prev.map(t =>
                    t.id === taskId
                        ? {
                            ...t,
                            status: response.isPlan ? "plan_ready" as const : "completed" as const,
                            result: response.content,
                            interactionId: response.interactionId,
                            completedAt: Date.now(),
                        }
                        : t
                ));
            })
            .catch(error => {
                const errorMsg = error instanceof Error ? error.message : String(error);
                setTasks(prev => prev.map(t =>
                    t.id === taskId
                        ? { ...t, status: "failed" as const, error: errorMsg, completedAt: Date.now() }
                        : t
                ));
            });

        return taskId;
    }, []);

    const dismissTask = useCallback((taskId: string) => {
        setTasks(prev => prev.filter(t => t.id !== taskId));
    }, []);

    const clearCompleted = useCallback(() => {
        setTasks(prev => prev.filter(t => t.status === "running"));
    }, []);

    const runningTasks = tasks.filter(t => t.status === "running");
    const completedTasks = tasks.filter(t => t.status !== "running");

    return {
        tasks,
        runningTasks,
        completedTasks,
        startResearch,
        dismissTask,
        clearCompleted,
    };
}