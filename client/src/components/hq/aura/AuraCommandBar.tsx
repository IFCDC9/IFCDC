import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Mic, Send, X, ArrowRight, ShieldCheck, Loader2, Eraser } from "lucide-react";
import { hqApi, type AuraCommandResponse, type AuraExecutedAction } from "../../../api/hqApi";
import { grantsApi } from "../../../api/grantsApi";
import { AURA_OPEN_EVENT, type AuraOpenDetail } from "./auraBus";

interface AuraMessage {
  role: "user" | "aura";
  text: string;
  actions?: AuraExecutedAction[];
  navigation?: { path: string; label: string };
  approvals?: Array<{ path: string; label: string }>;
  error?: boolean;
  progress?: number;
  jobId?: string;
}

const SUGGESTIONS = [
  "Run enterprise mode — funding report for all IFCDC programs",
  "Find funding across all IFCDC programs",
  "Summarize the board report",
  "What needs my approval?",
];

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function extractEnterpriseJobId(res: AuraCommandResponse): string | undefined {
  if (res.enterpriseJobId) return res.enterpriseJobId;
  for (const action of res.actions ?? []) {
    const data = action.data as { jobId?: string } | undefined;
    if (data?.jobId) return String(data.jobId);
  }
  return undefined;
}

export function AuraCommandBar(): React.ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AuraMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [jobTracking, setJobTracking] = useState<{ jobId: string; messageIndex: number } | null>(null);
  const moduleRef = useRef<string | undefined>(undefined);
  const contextRef = useRef<Record<string, unknown> | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<ReturnType<SpeechRecognitionCtor> | null>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  const applyResponse = useCallback((res: AuraCommandResponse) => {
    const jobId = extractEnterpriseJobId(res);
    setMessages((prev) => {
      const next = [
        ...prev,
        {
          role: "aura" as const,
          text: res.reply,
          actions: res.actions,
          navigation: res.navigation,
          approvals: res.approvalsCreated,
          progress: jobId ? 2 : undefined,
          jobId,
        },
      ];
      if (jobId) setJobTracking({ jobId, messageIndex: next.length - 1 });
      return next;
    });
    scrollToEnd();
  }, [scrollToEnd]);

  useEffect(() => {
    if (!jobTracking) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { job, narrative } = await grantsApi.enterpriseFundingJob(jobTracking.jobId);
        if (cancelled) return;
        setMessages((prev) => {
          const copy = [...prev];
          const idx = jobTracking.messageIndex;
          if (!copy[idx] || copy[idx].jobId !== jobTracking.jobId) return prev;
          copy[idx] = {
            ...copy[idx],
            progress: job.progress,
            text:
              job.status === "completed" || job.status === "failed"
                ? narrative
                : `${job.message}\n\nProgress: ${job.progress}% · Phase: ${job.phase.replace(/_/g, " ")}`,
            error: job.status === "failed",
          };
          return copy;
        });
        scrollToEnd();
        if (job.status === "completed" || job.status === "failed") {
          setJobTracking(null);
        }
      } catch {
        /* keep polling until timeout window ends */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobTracking, scrollToEnd]);

  const runCommand = useCallback(
    async (text: string) => {
      const command = text.trim();
      if (!command || loading) return;
      setInput("");
      setMessages((prev) => [...prev, { role: "user", text: command }]);
      setLoading(true);
      scrollToEnd();
      try {
        const res = await hqApi.auraCommand(command, { module: moduleRef.current, contextRef: contextRef.current });
        applyResponse(res);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { role: "aura", text: err instanceof Error ? err.message : "AURA is unavailable right now.", error: true },
        ]);
        scrollToEnd();
      } finally {
        setLoading(false);
      }
    },
    [applyResponse, loading, scrollToEnd]
  );

  const runAction = useCallback(
    async (actionId: string, args?: Record<string, unknown>, label?: string) => {
      if (loading) return;
      setMessages((prev) => [...prev, { role: "user", text: label ? `${label}` : `Run ${actionId}` }]);
      setLoading(true);
      scrollToEnd();
      try {
        const res = await hqApi.auraAction(actionId, { args, module: moduleRef.current, contextRef: contextRef.current });
        applyResponse(res);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { role: "aura", text: err instanceof Error ? err.message : "AURA action failed.", error: true },
        ]);
        scrollToEnd();
      } finally {
        setLoading(false);
      }
    },
    [applyResponse, loading, scrollToEnd]
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AuraOpenDetail>).detail ?? {};
      moduleRef.current = detail.module;
      contextRef.current = detail.contextRef;
      setOpen(true);
      if (detail.actionId) {
        void runAction(detail.actionId, detail.args, detail.prefill);
      } else if (detail.prefill) {
        setInput(detail.prefill);
        if (detail.autoRun) void runCommand(detail.prefill);
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener(AURA_OPEN_EVENT, handler);
    return () => window.removeEventListener(AURA_OPEN_EVENT, handler);
  }, [runAction, runCommand]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleVoice = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [listening]);

  const goTo = useCallback(
    (path: string) => {
      setOpen(false);
      navigate(path);
    },
    [navigate]
  );

  const clearMemory = useCallback(async () => {
    setMessages([]);
    try {
      await hqApi.auraMemoryReset();
    } catch {
      /* non-blocking */
    }
  }, []);

  const voiceSupported = Boolean(getSpeechRecognition());

  return (
    <>
      {!open && (
        <button
          type="button"
          className="hq-aura-fab"
          onClick={() => {
            moduleRef.current = undefined;
            contextRef.current = undefined;
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          aria-label="Ask AURA"
          title="Ask AURA"
        >
          <Sparkles size={22} />
        </button>
      )}

      {open && (
        <div className="hq-aura-cmd" role="dialog" aria-label="AURA command bar">
          <div className="hq-aura-cmd-header">
            <div className="hq-aura-cmd-title">
              <Sparkles size={16} />
              <span>AURA</span>
              <span className="hq-aura-cmd-badge">Command Layer</span>
            </div>
            <div className="hq-aura-cmd-header-actions">
              <button type="button" className="hq-aura-cmd-icon" onClick={clearMemory} title="Clear conversation" aria-label="Clear conversation">
                <Eraser size={15} />
              </button>
              <button type="button" className="hq-aura-cmd-icon" onClick={() => setOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="hq-aura-cmd-body">
            {messages.length === 0 && (
              <div className="hq-aura-cmd-empty">
                <ShieldCheck size={20} />
                <p>Run IFCDC by command. AURA prepares, drafts, and recommends using live data — nothing is submitted, sent, or spent without your approval.</p>
                <div className="hq-aura-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="hq-aura-suggestion" onClick={() => runCommand(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`hq-aura-msg ${m.role === "user" ? "user" : "aura"}`}>
                <div className={`hq-aura-bubble ${m.error ? "hq-aura-bubble-error" : ""}`}>
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
                  {typeof m.progress === "number" && m.progress < 100 && !m.error && (
                    <div style={{ marginTop: "0.65rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: 4 }}>
                        <span>Enterprise scan</span>
                        <span>{m.progress}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(4, m.progress)}%`, height: "100%", background: "var(--hq-gold, #c9a227)", transition: "width 0.4s ease" }} />
                      </div>
                    </div>
                  )}
                  {m.approvals && m.approvals.length > 0 && (
                    <div className="hq-aura-approval-note">
                      <ShieldCheck size={14} />
                      <span>Prepared — awaiting your approval.</span>
                      <button type="button" className="hq-aura-inline-link" onClick={() => goTo(m.approvals![0].path)}>
                        {m.approvals[0].label}
                      </button>
                    </div>
                  )}
                  {m.navigation && (
                    <button type="button" className="hq-aura-open-btn" onClick={() => goTo(m.navigation!.path)}>
                      {m.navigation.label} <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="hq-aura-msg aura">
                <div className="hq-aura-bubble hq-aura-thinking">
                  <Loader2 size={15} className="hq-spin" /> AURA is working…
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            className="hq-aura-cmd-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              runCommand(input);
            }}
          >
            <input
              ref={inputRef}
              className="hq-aura-input"
              placeholder="Ask or command AURA…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            {voiceSupported && (
              <button
                type="button"
                className={`hq-aura-cmd-icon ${listening ? "listening" : ""}`}
                onClick={toggleVoice}
                aria-label={listening ? "Stop listening" : "Speak a command"}
                title={listening ? "Stop listening" : "Speak a command"}
              >
                <Mic size={16} />
              </button>
            )}
            <button type="submit" className="hq-aura-send" disabled={loading || !input.trim()} aria-label="Send">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export default AuraCommandBar;
