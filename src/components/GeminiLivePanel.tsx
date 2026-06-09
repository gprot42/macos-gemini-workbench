import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mic, MicOff, PhoneOff, Phone, Send, Trash2 } from "lucide-react";
import {
  TRANSLATION_LANGUAGES,
  languageLabel,
  type LiveSessionMode,
} from "@/lib/languages";
import { loadLivePrefs, saveLivePrefs } from "@/lib/livePrefs";

interface GeminiLivePanelProps {
  apiKey: string;
}

interface LiveMessage {
  role: "user" | "model" | "system";
  text: string;
}

type LegacyNavigator = Navigator & {
  getUserMedia?: (
    constraints: MediaStreamConstraints,
    successCallback: (stream: MediaStream) => void,
    errorCallback: (err: unknown) => void
  ) => void;
  webkitGetUserMedia?: (
    constraints: MediaStreamConstraints,
    successCallback: (stream: MediaStream) => void,
    errorCallback: (err: unknown) => void
  ) => void;
};

const LIVE_AGENT_MODEL = {
  id: "gemini-3.1-flash-live-preview",
  display: "Gemini 3.1 Flash Live",
} as const;

const LIVE_TRANSLATE_MODEL = {
  id: "gemini-3.5-live-translate-preview",
  display: "Gemini 3.5 Live Translate",
} as const;

const WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const WORKLET_CODE = `
class PCMStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(24000 * 60);
    this.writePos = 0;
    this.readPos = 0;
    this.available = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === 'audio') {
        const samples = e.data.samples;
        for (let i = 0; i < samples.length; i++) {
          this.buffer[this.writePos] = samples[i];
          this.writePos = (this.writePos + 1) % this.buffer.length;
        }
        this.available = Math.min(this.available + samples.length, this.buffer.length);
      } else if (e.data.type === 'clear') {
        this.writePos = 0;
        this.readPos = 0;
        this.available = 0;
      }
    };
  }
  process(inputs, outputs) {
    const output = outputs[0][0];
    const toRead = Math.min(output.length, this.available);
    for (let i = 0; i < toRead; i++) {
      output[i] = this.buffer[this.readPos];
      this.readPos = (this.readPos + 1) % this.buffer.length;
    }
    for (let i = toRead; i < output.length; i++) {
      output[i] = 0;
    }
    this.available -= toRead;
    this.port.postMessage({ playing: toRead > 0 });
    return true;
  }
}
registerProcessor('pcm-stream-processor', PCMStreamProcessor);
`;

const MODE_OPTIONS: { id: LiveSessionMode; label: string; hint: string }[] = [
  { id: "conversation", label: "Conversation", hint: "Free-form voice chat (3.1 Flash Live)" },
  { id: "translate", label: "Translate", hint: "Auto-detect source, translate into target (3.5 Live Translate)" },
  { id: "bidirectional", label: "Two-way", hint: "Translate to target; echo when input matches target (3.5 Live Translate)" },
];

function modelForMode(mode: LiveSessionMode) {
  return mode === "conversation" ? LIVE_AGENT_MODEL : LIVE_TRANSLATE_MODEL;
}

function buildSetup(
  mode: LiveSessionMode,
  targetLanguage: string,
  customInstruction: string
): Record<string, unknown> {
  if (mode === "conversation") {
    const setup: Record<string, unknown> = {
      model: `models/${LIVE_AGENT_MODEL.id}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Puck" },
          },
        },
      },
      outputAudioTranscription: {},
      inputAudioTranscription: {},
    };

    const instruction = customInstruction.trim();
    if (instruction) {
      setup.systemInstruction = { parts: [{ text: instruction }] };
    }

    return setup;
  }

  return {
    model: `models/${LIVE_TRANSLATE_MODEL.id}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      translationConfig: {
        targetLanguageCode: targetLanguage,
        echoTargetLanguage: mode === "bidirectional",
      },
    },
  };
}

function sessionStartMessage(mode: LiveSessionMode, targetLanguage: string): string {
  if (mode === "conversation") {
    return `Session started (${LIVE_AGENT_MODEL.display})`;
  }

  const target = languageLabel(targetLanguage);
  if (mode === "bidirectional") {
    return `Two-way interpreter → ${target} (echo when input matches target)`;
  }
  return `Interpreter → ${target}`;
}

export function GeminiLivePanel({ apiKey }: GeminiLivePanelProps) {
  const initialPrefs = loadLivePrefs();
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [modelSpeaking, setModelSpeaking] = useState(false);
  const [sessionMode, setSessionMode] = useState<LiveSessionMode>(initialPrefs.sessionMode);
  const [targetLanguage, setTargetLanguage] = useState(initialPrefs.targetLanguage);
  const [customInstruction, setCustomInstruction] = useState(initialPrefs.customInstruction);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [textInput, setTextInput] = useState("");

  const activeModel = modelForMode(sessionMode);
  const isConversation = sessionMode === "conversation";

  const wsRef = useRef<WebSocket | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingModelTextRef = useRef("");
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    saveLivePrefs({ sessionMode, targetLanguage, customInstruction });
  }, [sessionMode, targetLanguage, customInstruction]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startPlaybackPipeline = useCallback(async () => {
    if (playbackCtxRef.current) return;

    const ctx = new AudioContext({ sampleRate: 24000 });
    playbackCtxRef.current = ctx;

    const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const node = new AudioWorkletNode(ctx, "pcm-stream-processor");
    workletNodeRef.current = node;

    node.port.onmessage = (e) => {
      const isPlaying = e.data.playing;
      if (isPlaying) {
        if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
        setModelSpeaking(true);
        speakingTimerRef.current = setTimeout(() => setModelSpeaking(false), 300);
      }
    };

    node.connect(ctx.destination);
  }, []);

  const stopPlaybackPipeline = useCallback(() => {
    workletNodeRef.current?.port.postMessage({ type: "clear" });
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    playbackCtxRef.current?.close();
    playbackCtxRef.current = null;
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    setModelSpeaking(false);
  }, []);

  const enqueueAudio = useCallback((pcmBuffer: ArrayBuffer) => {
    const float32 = pcm16ToFloat32(pcmBuffer);
    workletNodeRef.current?.port.postMessage(
      { type: "audio", samples: float32 },
      [float32.buffer]
    );

    if (playbackCtxRef.current?.state === "suspended") {
      playbackCtxRef.current.resume();
    }
  }, []);

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      const parseMessage = (raw: string) => {
        try {
          const data = JSON.parse(raw);

          if (data.setupComplete !== undefined) {
            setConnected(true);
            setConnecting(false);
            return;
          }

          if (data.serverContent) {
            const parts = data.serverContent.modelTurn?.parts || [];

            if (data.serverContent.interrupted) {
              workletNodeRef.current?.port.postMessage({ type: "clear" });
              setModelSpeaking(false);
            }

            for (const part of parts) {
              if (part.text && !part.thought) {
                pendingModelTextRef.current += part.text;
              }
              if (part.inlineData?.data) {
                const binary = atob(part.inlineData.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                  bytes[i] = binary.charCodeAt(i);
                }
                enqueueAudio(bytes.buffer);
              }
            }

            if (data.serverContent.outputTranscription?.text) {
              pendingModelTextRef.current += data.serverContent.outputTranscription.text;
            }

            if (data.serverContent.inputTranscription?.text) {
              const userText = data.serverContent.inputTranscription.text.trim();
              if (userText) {
                setMessages((prev) => [...prev, { role: "user", text: userText }]);
              }
            }

            if (data.serverContent.turnComplete) {
              if (pendingModelTextRef.current) {
                setMessages((prev) => [
                  ...prev,
                  { role: "model", text: pendingModelTextRef.current.trim() },
                ]);
                pendingModelTextRef.current = "";
              }
            }
          }
        } catch (err) {
          console.error("[GeminiLive] Parse error:", err);
        }
      };

      if (event.data instanceof Blob) {
        event.data.text().then(parseMessage);
      } else {
        parseMessage(event.data);
      }
    },
    [enqueueAudio]
  );

  const stopMic = () => {
    micProcessorRef.current?.disconnect();
    micProcessorRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micCtxRef.current?.close();
    micCtxRef.current = null;
  };

  const toggleMic = useCallback(async () => {
    if (micActive) {
      stopMic();
      setMicActive(false);
      return;
    }

    try {
      const stream = await getUserMediaCompat({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;

      const ctx = new AudioContext();
      micCtxRef.current = ctx;
      const nativeSR = ctx.sampleRate;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      micProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const ratio = nativeSR / 16000;
        const outputLen = Math.floor(inputData.length / ratio);
        const resampled = new Float32Array(outputLen);
        for (let i = 0; i < outputLen; i++) {
          resampled[i] = inputData[Math.floor(i * ratio)];
        }

        const pcm = float32ToPcm16(resampled);
        const b64 = arrayBufferToBase64(pcm);

        wsRef.current.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
            },
          })
        );
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setMicActive(true);
    } catch (err) {
      console.error("Mic access failed:", err);
      setConnectionError("Microphone unavailable in this runtime or permission denied");
    }
  }, [micActive]);

  useEffect(() => {
    if (connected && !micActive) {
      toggleMic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const connect = useCallback(async () => {
    if (!apiKey) return;
    setConnecting(true);
    setConnectionError(null);

    await startPlaybackPipeline();

    const ws = new WebSocket(`${WS_URL}?key=${apiKey}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ setup: buildSetup(sessionMode, targetLanguage, customInstruction) }));
    };

    ws.onmessage = handleWsMessage;

    ws.onclose = (e) => {
      setConnected(false);
      setConnecting(false);
      setMicActive(false);
      if (e.code !== 1000 && e.code !== 1005) {
        setConnectionError(`Connection closed: ${e.code} ${e.reason || "(no reason)"}`);
      }
      stopMic();
      stopPlaybackPipeline();
    };

    ws.onerror = () => {
      setConnectionError("WebSocket connection failed");
      setConnected(false);
      setConnecting(false);
      stopPlaybackPipeline();
    };

    setMessages((prev) => [
      ...prev,
      { role: "system", text: sessionStartMessage(sessionMode, targetLanguage) },
    ]);
  }, [
    apiKey,
    customInstruction,
    handleWsMessage,
    sessionMode,
    targetLanguage,
    startPlaybackPipeline,
    stopPlaybackPipeline,
  ]);

  const disconnect = useCallback(() => {
    stopMic();
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setMicActive(false);
    stopPlaybackPipeline();
  }, [stopPlaybackPipeline]);

  const sendText = useCallback(() => {
    const text = textInput.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({ realtimeInput: { text } }));
    setMessages((prev) => [...prev, { role: "user", text }]);
    setTextInput("");
  }, [textInput]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {!connected && (
        <div className="border-b theme-border p-4 theme-surface shrink-0">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex flex-wrap gap-2">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSessionMode(opt.id)}
                  className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                    sessionMode === opt.id
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "theme-surface theme-border theme-text hover:bg-muted"
                  }`}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {!isConversation && (
              <label className="flex items-center gap-2 text-sm theme-text">
                <span className="theme-text-muted w-12">Into</span>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="rounded-md border theme-border theme-surface px-2 py-1.5 text-sm min-w-[180px]"
                >
                  {TRANSLATION_LANGUAGES.map((lang) => (
                    <option key={lang.id} value={lang.id}>
                      {lang.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs theme-text-muted">Source language is auto-detected</span>
              </label>
            )}

            {isConversation && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs theme-text-muted hover:theme-text transition-colors"
                >
                  {showAdvanced ? "Hide" : "Show"} custom system instruction
                </button>
                {showAdvanced && (
                  <Textarea
                    value={customInstruction}
                    onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder="Optional: custom instructions for the session (e.g. speak slowly, use formal tone)"
                    className="mt-2 min-h-[72px] text-sm"
                  />
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={connect} disabled={!apiKey || connecting} className="gap-2">
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Phone className="h-4 w-4" />
                )}
                {connecting ? "Connecting..." : "Start Session"}
              </Button>
              {messages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMessages([])}
                  className="gap-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear transcript
                </Button>
              )}
              {!apiKey && (
                <span className="text-xs text-amber-600">AI Studio API key required in Settings</span>
              )}
            </div>
            <div className="text-xs theme-text-muted">
              Model: <span className="font-mono">{activeModel.display}</span>
              <span className="mx-1.5">·</span>
              <span className="font-mono">{activeModel.id}</span>
            </div>
            {connectionError && (
              <div className="text-red-500 text-sm">{connectionError}</div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {messages.length === 0 && !connected ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-tokyo-muted gap-4">
            <div className="text-6xl">🎙️</div>
            <div className="text-center max-w-md">
              <div className="text-xl font-semibold">Gemini Live</div>
              <div className="text-sm mt-2 theme-text-muted leading-relaxed">
                <strong>Conversation</strong> uses {LIVE_AGENT_MODEL.display} for free-form voice chat.
                <strong> Translate</strong> and <strong>Two-way</strong> use {LIVE_TRANSLATE_MODEL.display}{" "}
                for real-time speech-to-speech translation across 70+ languages.
              </div>
              <div className="text-xs mt-3 theme-text-muted">
                Selected: <span className="font-mono">{activeModel.display}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${
                  msg.role === "user"
                    ? "justify-end"
                    : msg.role === "system"
                      ? "justify-center"
                      : "justify-start"
                }`}
              >
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm max-w-[80%] leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-md"
                      : msg.role === "system"
                        ? "theme-text-muted text-xs italic bg-muted/50 px-3 py-1.5 rounded-lg"
                        : "theme-surface border theme-border rounded-bl-md theme-text"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {modelSpeaking && (
              <div className="flex justify-start">
                <div className="px-4 py-2.5 rounded-2xl text-sm theme-surface border theme-border rounded-bl-md theme-text-muted italic flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                  Speaking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {connected && (
        <div className="border-t theme-border p-3 theme-surface space-y-2 shrink-0">
          {isConversation && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendText()}
                placeholder="Send a text message (e.g. change topic or give instructions)"
                className="flex-1 rounded-md border theme-border theme-surface px-3 py-2 text-sm"
              />
              <Button size="sm" onClick={sendText} disabled={!textInput.trim()} className="gap-1.5">
                <Send className="h-4 w-4" />
                Send
              </Button>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant={micActive ? "destructive" : "default"}
              size="sm"
              onClick={toggleMic}
              className="gap-1.5"
            >
              {micActive ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {micActive ? "Mute" : "Unmute"}
            </Button>
            <div className="flex-1" />
            {micActive && (
              <span className="text-xs theme-text-muted flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Listening...
              </span>
            )}
            {modelSpeaking && !micActive && (
              <span className="text-xs theme-text-muted flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                Gemini is speaking...
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={disconnect}
              className="gap-1.5 text-red-500 hover:text-red-600"
            >
              <PhoneOff className="h-4 w-4" />
              End
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const length = buffer.byteLength / 2;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

function float32ToPcm16(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function getUserMediaCompat(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const legacy = navigator as LegacyNavigator;
  const legacyGetUserMedia = legacy.getUserMedia || legacy.webkitGetUserMedia;
  if (!legacyGetUserMedia) {
    throw new Error("Microphone API not available in this runtime");
  }

  return new Promise((resolve, reject) => {
    legacyGetUserMedia.call(legacy, constraints, resolve, reject);
  });
}