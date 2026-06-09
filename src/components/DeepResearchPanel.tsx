import { useState, useRef, useEffect, useCallback } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResearchTask } from "../hooks/useResearchSessions";
import { McpServerConfig } from "../types";
import {
  DeepResearchOptions,
  ResearchAttachment,
  ResearchImage,
  DEEP_RESEARCH_AGENTS,
  DeepResearchAgentMode,
  loadDeepResearchPrefs,
  saveDeepResearchPrefs,
} from "../lib/deepResearch";

interface FileSearchStore {
  name: string;
  displayName: string;
}

interface DeepResearchPanelProps {
  apiKey: string;
  activeProject: string | null;
  mcpServers?: McpServerConfig[];
  research: {
    tasks: ResearchTask[];
    runningTasks: ResearchTask[];
    completedTasks: ResearchTask[];
    startResearch: (options: DeepResearchOptions) => Promise<string>;
    continueResearch: (
      taskId: string,
      prompt: string,
      collaborativePlanning: boolean,
      options: Omit<DeepResearchOptions, "prompt" | "previousInteractionId" | "collaborativePlanning">
    ) => Promise<void>;
    cancelTask: (taskId: string) => void;
    dismissTask: (taskId: string) => void;
    clearCompleted: () => void;
  };
}

const AGENT_CONFIG: Record<
  DeepResearchAgentMode,
  { timeout: number; label: string; subtitle: string }
> = {
  standard: { timeout: 60, label: "Standard", subtitle: "Fast research" },
  max: { timeout: 120, label: "Max", subtitle: "Deeper synthesis" },
};

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Math.floor((Date.now() - startedAt) / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return (
    <span className="font-mono">
      {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
    </span>
  );
}

function ResearchImages({ images }: { images: ResearchImage[] }) {
  if (!images.length) return null;
  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {images.map((img, i) => (
        <img
          key={i}
          src={`data:${img.mimeType};base64,${img.data}`}
          alt={`Research visualization ${i + 1}`}
          className="rounded-lg border theme-border max-w-full"
        />
      ))}
    </div>
  );
}

function PlanReviewCard({
  task,
  onApprove,
  onRefine,
  onCancel,
}: {
  task: ResearchTask;
  onApprove: () => void;
  onRefine: (feedback: string) => void;
  onCancel: () => void;
}) {
  const [feedback, setFeedback] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm font-medium">
        <span>📋</span>
        <span>Research plan ready for review</span>
      </div>
      {task.result && (
        <pre className="whitespace-pre-wrap font-sans text-base leading-relaxed theme-text bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          {task.result}
        </pre>
      )}
      <ResearchImages images={task.images || []} />
      <Textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Optional: refine the plan before approving..."
        className="text-sm min-h-[72px]"
        rows={3}
      />
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={onApprove}>
          Approve & Run
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => feedback.trim() && onRefine(feedback)}
          disabled={!feedback.trim()}
        >
          Refine Plan
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function DeepResearchPanel({
  apiKey,
  activeProject,
  mcpServers = [],
  research,
}: DeepResearchPanelProps) {
  const savedPrefs = loadDeepResearchPrefs();
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);
  const [savedIdx, setSavedIdx] = useState<string | null>(null);
  const [timeoutMinutes, setTimeoutMinutes] = useState(savedPrefs.timeoutMinutes);
  const [agentMode, setAgentMode] = useState<DeepResearchAgentMode>(savedPrefs.agentMode);
  const [collaborativePlanning, setCollaborativePlanning] = useState(savedPrefs.collaborativePlanning);
  const [visualization, setVisualization] = useState(savedPrefs.visualization);
  const [fileSearchStoreName, setFileSearchStoreName] = useState(savedPrefs.fileSearchStoreName);
  const [stores, setStores] = useState<FileSearchStore[]>([]);
  const [attachments, setAttachments] = useState<ResearchAttachment[]>([]);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveDeepResearchPrefs({
      agentMode,
      timeoutMinutes,
      collaborativePlanning,
      visualization,
      fileSearchStoreName,
    });
  }, [agentMode, timeoutMinutes, collaborativePlanning, visualization, fileSearchStoreName]);

  const loadStores = useCallback(async () => {
    if (!apiKey) return;
    try {
      const result = await invoke<Record<string, unknown>>("rag_list_stores", { apiKey });
      setStores((result.fileSearchStores as FileSearchStore[]) || []);
    } catch {
      setStores([]);
    }
  }, [apiKey]);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  const buildOptions = useCallback(
    (prompt: string): DeepResearchOptions => ({
      prompt,
      apiKey,
      timeoutMinutes,
      agent: DEEP_RESEARCH_AGENTS[agentMode],
      collaborativePlanning: collaborativePlanning || undefined,
      visualization: visualization || undefined,
      fileSearchStoreNames: fileSearchStoreName ? [fileSearchStoreName] : undefined,
      mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    }),
    [
      apiKey,
      timeoutMinutes,
      agentMode,
      collaborativePlanning,
      visualization,
      fileSearchStoreName,
      mcpServers,
      attachments,
    ]
  );

  const handleAgentModeChange = (mode: DeepResearchAgentMode) => {
    setAgentMode(mode);
    setTimeoutMinutes(AGENT_CONFIG[mode].timeout);
  };

  const handleResearch = async () => {
    if ((!query.trim() && attachments.length === 0) || !apiKey) return;

    setLastQuery(query);
    await research.startResearch(buildOptions(query));
    setQuery("");
    setAttachments([]);
    resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleContinue = async (
    task: ResearchTask,
    prompt: string,
    planning: boolean
  ) => {
    await research.continueResearch(task.id, prompt, planning, {
      apiKey,
      timeoutMinutes: task.timeoutMinutes || timeoutMinutes,
      agent: task.agent || DEEP_RESEARCH_AGENTS[agentMode],
      visualization: visualization || undefined,
      fileSearchStoreNames: fileSearchStoreName ? [fileSearchStoreName] : undefined,
      mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
    });
    resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleAttachFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: "Images & Documents", extensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      const newAttachments: ResearchAttachment[] = [];

      for (const path of paths) {
        const fileData = await readFile(path);
        const base64 = btoa(String.fromCharCode(...fileData));
        const ext = path.split(".").pop()?.toLowerCase() || "";
        const name = path.split("/").pop() || path;

        let mimeType = "application/octet-stream";
        if (ext === "png") mimeType = "image/png";
        else if (["jpg", "jpeg"].includes(ext)) mimeType = "image/jpeg";
        else if (ext === "gif") mimeType = "image/gif";
        else if (ext === "webp") mimeType = "image/webp";
        else if (ext === "pdf") mimeType = "application/pdf";

        newAttachments.push({ data: base64, mimeType, name });
      }

      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch (e) {
      console.error("Failed to attach files:", e);
    }
  };

  const handleResend = () => {
    if (lastQuery) setQuery(lastQuery);
  };

  const handleCopy = async (content: string, taskId: string) => {
    try {
      await writeText(content);
      setCopiedIdx(taskId);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const handleSave = async (content: string, taskId: string) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `research-${timestamp}.md`;

      if (activeProject) {
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });
        await invoke("save_to_project", { projectPath, subfolder: "outputs", filename, content });
      } else {
        await invoke("save_output", { content, filename });
      }

      setSavedIdx(taskId);
      setTimeout(() => setSavedIdx(null), 2000);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  };

  const handleSavePdf = (content: string, taskQuery: string) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Research: ${taskQuery}</title>
      <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;color:#1a1a1a}
      h1{font-size:1.4em;border-bottom:1px solid #ddd;padding-bottom:8px}pre{white-space:pre-wrap;font-family:inherit;font-size:14px}</style>
      </head><body><h1>${taskQuery}</h1><pre>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      <script>window.onafterprint=()=>window.close();window.print();<\/script></body></html>`);
    printWindow.document.close();
  };

  const planReadyTasks = research.completedTasks.filter((t) => t.status === "plan_ready");
  const finishedTasks = research.completedTasks.filter((t) => t.status !== "plan_ready");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {research.runningTasks.length > 0 && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
              <span className="font-medium">{research.runningTasks.length} research task(s) running</span>
            </div>
            <div className="mt-2 space-y-2">
              {research.runningTasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between text-sm text-blue-700 dark:text-blue-300">
                  <span className="truncate flex-1 mr-3">• {task.query}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      <ElapsedTimer startedAt={task.startedAt} />
                    </span>
                    <button
                      onClick={() => research.cancelTask(task.id)}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                      title="Cancel research"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {planReadyTasks.length > 0 && (
          <div className="mb-4 space-y-3">
            {planReadyTasks.map((task) => (
              <div key={task.id} className="theme-surface border border-amber-300 dark:border-amber-700 rounded-2xl p-4">
                <div className="text-sm font-medium theme-text mb-3 truncate">{task.query}</div>
                <PlanReviewCard
                  task={task}
                  onApprove={() => handleContinue(task, "Plan looks good! Proceed with the research.", false)}
                  onRefine={(feedback) => handleContinue(task, feedback, true)}
                  onCancel={() => research.cancelTask(task.id)}
                />
              </div>
            ))}
          </div>
        )}

        {research.tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-6">
            <div className="text-8xl">🔬</div>
            <div className="text-center">
              <div className="text-2xl font-semibold">Gemini Deep Research</div>
              <div className="text-xl mt-1">Multi-step web research with source synthesis</div>
              <div className="text-base mt-4 max-w-lg text-center leading-relaxed">
                Enter a research question and the agent will search the web,
                analyze multiple sources, and synthesize a comprehensive answer
                with citations. Enable collaborative planning to review the plan first.
              </div>
              <div className="text-sm mt-3 text-amber-600 dark:text-amber-400">
                Research can take several minutes to complete
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {finishedTasks.map((task) => (
            <div key={task.id} className="theme-surface border theme-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b theme-border bg-gray-50 dark:bg-gray-800/50">
                {task.status === "failed" ? (
                  <span className="text-lg">❌</span>
                ) : task.status === "cancelled" ? (
                  <span className="text-lg">🚫</span>
                ) : (
                  <span className="text-lg">🔬</span>
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1 truncate">{task.query}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(task.completedAt || task.startedAt).toLocaleTimeString()}
                </span>
              </div>

              <div className="p-4">
                {(task.status === "failed" || task.status === "cancelled") && (
                  <div className="text-base text-red-600 dark:text-red-400">
                    {task.error || "Research failed"}
                  </div>
                )}

                {task.status === "completed" && task.result && (
                  <>
                    <pre className="whitespace-pre-wrap font-sans text-base leading-relaxed theme-text">
                      {task.result}
                    </pre>
                    <ResearchImages images={task.images || []} />
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 px-4 py-2 border-t theme-border bg-gray-50 dark:bg-gray-800/50">
                {task.result && task.status === "completed" && (
                  <>
                    <button
                      onClick={() => handleCopy(task.result!, task.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text"
                    >
                      {copiedIdx === task.id ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={() => handleSave(task.result!, task.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text"
                    >
                      {savedIdx === task.id ? "Saved!" : "Save Markdown"}
                    </button>
                    <button
                      onClick={() => handleSavePdf(task.result!, task.query)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text"
                    >
                      Save PDF
                    </button>
                  </>
                )}
                <div className="flex-1" />
                <button
                  onClick={() => research.dismissTask(task.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div ref={resultsEndRef} />
      </div>

      <div className="border-t theme-border p-3 theme-surface space-y-2">
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs theme-text-muted">Agent:</span>
          <div className="flex gap-1">
            {(["standard", "max"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleAgentModeChange(mode)}
                title={AGENT_CONFIG[mode].subtitle}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  agentMode === mode
                    ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium"
                    : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {AGENT_CONFIG[mode].label}
              </button>
            ))}
          </div>
          <span className="text-xs theme-text-muted">{AGENT_CONFIG[agentMode].subtitle}</span>

          <select
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
            className="text-xs px-2 py-1 rounded-md border theme-border bg-white dark:bg-gray-800 theme-text ml-2"
            title="Timeout"
          >
            {[15, 30, 45, 60, 90, 120, 180].map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 items-center flex-wrap text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer theme-text-muted">
            <input
              type="checkbox"
              checked={collaborativePlanning}
              onChange={(e) => setCollaborativePlanning(e.target.checked)}
              className="rounded"
            />
            Plan first
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer theme-text-muted">
            <input
              type="checkbox"
              checked={visualization}
              onChange={(e) => setVisualization(e.target.checked)}
              className="rounded"
            />
            Charts & visuals
          </label>
          {stores.length > 0 && (
            <select
              value={fileSearchStoreName}
              onChange={(e) => setFileSearchStoreName(e.target.value)}
              className="text-xs px-2 py-1 rounded-md border theme-border bg-white dark:bg-gray-800 theme-text"
              title="Knowledge base"
            >
              <option value="">No knowledge base</option>
              {stores.map((s) => (
                <option key={s.name} value={s.name}>{s.displayName || s.name}</option>
              ))}
            </select>
          )}
          {mcpServers.length > 0 && (
            <span className="text-green-600 dark:text-green-400">
              {mcpServers.length} MCP server{mcpServers.length > 1 ? "s" : ""} enabled
            </span>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((att, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-800 theme-text"
              >
                {att.name || att.mimeType}
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-red-500 hover:text-red-600"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-start">
          <div className="flex-1 space-y-1">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter your research question..."
              className="resize-none text-sm min-h-[96px]"
              rows={4}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Button
              onClick={handleAttachFiles}
              size="sm"
              variant="outline"
              className="h-10 px-2"
              title="Attach images or PDFs"
            >
              📎
            </Button>
            <Button
              onClick={handleResearch}
              disabled={(!query.trim() && attachments.length === 0) || !apiKey}
              size="sm"
              className="h-10 px-3"
            >
              Go
            </Button>
            <Button
              onClick={handleResend}
              size="sm"
              variant="outline"
              className="h-10 px-2"
              disabled={!lastQuery || research.runningTasks.length > 0}
              title="Resend last query"
            >
              ↻
            </Button>
            <Button
              onClick={research.clearCompleted}
              size="sm"
              variant="outline"
              className="h-10 px-3"
              disabled={research.completedTasks.length === 0}
              title="Clear all results"
            >
              Clear
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}