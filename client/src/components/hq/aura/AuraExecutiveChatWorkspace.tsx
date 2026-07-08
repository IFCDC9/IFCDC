import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eraser,
  FileText,
  FolderOpen,
  Loader2,
  Mic,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { hqApi, type AuraCommandResponse } from "../../../api/hqApi";
import { grantsApi } from "../../../api/grantsApi";
import {
  CONTINUE_CHUNK_CHARS,
  LONG_REPORT_COLLAPSE_CHARS,
  newMessageId,
  shouldCollapse,
  type AuraChatMessageModel,
} from "./auraChatTypes";
import {
  copyAuraText,
  exportAuraReportMarkdown,
  exportAuraReportPdf,
  saveAuraReport,
} from "./auraChatActions";

const DEFAULT_SUGGESTIONS = [
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
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
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

function revealStreamingText(
  full: string,
  onChunk: (partial: string, done: boolean) => void
): () => void {
  let i = 0;
  const step = Math.max(24, Math.floor(full.length / 80));
  const timer = window.setInterval(() => {
    i = Math.min(full.length, i + step);
    onChunk(full.slice(0, i), i >= full.length);
    if (i >= full.length) window.clearInterval(timer);
  }, 28);
  return () => window.clearInterval(timer);
}

export type AuraExecutiveChatWorkspaceProps = {
  variant: "page" | "drawer";
  module?: string;
  contextRef?: Record<string, unknown>;
  suggestions?: string[];
  onClose?: () => void;
  /** When set, auto-run this command once after mount/open. */
  autoCommand?: { text?: string; actionId?: string; args?: Record<string, unknown>; label?: string };
  className?: string;
};

export function AuraExecutiveChatWorkspace({
  variant,
  module,
  contextRef,
  suggestions = DEFAULT_SUGGESTIONS,
  onClose,
  autoCommand,
  className,
}: AuraExecutiveChatWorkspaceProps): React.ReactElement {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<AuraChatMessageModel[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [jobTracking, setJobTracking] = useState<{ jobId: string; messageId: string } | null>(null);
  const [founderMode, setFounderMode] = useState(false);
  const [identityLabel, setIdentityLabel] = useState<string | null>(null);

  const moduleRef = useRef(module);
  const contextRefBox = useRef(contextRef);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<ReturnType<SpeechRecognitionCtor> | null>(null);
  const streamCleanups = useRef<Array<() => void>>([]);
  const autoRan = useRef(false);
  const historyLoaded = useRef(false);

  useEffect(() => {
    moduleRef.current = module;
    contextRefBox.current = contextRef;
  }, [module, contextRef]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const scrollToEnd = useCallback(
    (force = false) => {
      if (!force && !stickToBottom) return;
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    },
    [stickToBottom]
  );

  const onScrollBody = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distance < 120);
  }, []);

  useEffect(() => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;
    void (async () => {
      try {
        const [{ turns }, identityRes] = await Promise.all([
          hqApi.auraMemory(),
          hqApi.auraIdentity().catch(() => null),
        ]);
        if (identityRes?.identity) {
          setFounderMode(Boolean(identityRes.identity.founderMode));
          const seamless = Boolean(identityRes.identity.seamless || identityRes.device?.trusted);
          setIdentityLabel(
            identityRes.identity.founderMode
              ? `Founder Mode · ${identityRes.identity.displayName || "Fahreal Allah"}${seamless ? " · Trusted device" : ""}`
              : identityRes.identity.enterpriseRoleLabel
          );

          // Register this browser as a trusted Founder device once.
          // Face ID / Touch ID is preferred when the platform supports it;
          // password-authenticated HQ Founder sessions still get seamless trust.
          if (identityRes.identity.isFounder && !identityRes.device?.trusted) {
            try {
              const { gateFounderBiometric, getOrCreateFounderDeviceId } = await import(
                "../../../lib/founderTrustedDevice"
              );
              const deviceId = getOrCreateFounderDeviceId();
              const bio = await gateFounderBiometric(deviceId);
              const trust = await hqApi.auraTrustDevice({
                biometricBound: bio.biometricBound,
                label: "Founder HQ browser",
              });
              if (trust.ok) {
                setIdentityLabel(
                  `Founder Mode · ${identityRes.identity.displayName || "Fahreal Allah"} · Trusted device`
                );
              }
            } catch {
              /* trust binding is best-effort */
            }
          }
        }
        if (!turns?.length) return;
        setMessages(
          turns.map((t) => ({
            id: t.id || newMessageId(),
            role: t.role === "user" ? "user" : "aura",
            text: t.content,
            fullText: t.content,
            collapsed: shouldCollapse(t.content),
            createdAt: t.createdAt || new Date().toISOString(),
          }))
        );
        scrollToEnd(true);
      } catch {
        /* memory optional */
      }
    })();
  }, [scrollToEnd]);

  const updateMessage = useCallback((id: string, patch: Partial<AuraChatMessageModel>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const applyResponse = useCallback(
    (res: AuraCommandResponse) => {
      if (res.identity) {
        setFounderMode(Boolean(res.identity.founderMode));
        setIdentityLabel(
          res.identity.founderMode
            ? `Founder Mode · ${res.identity.displayName || "Fahreal Allah"}`
            : res.identity.enterpriseRoleLabel
        );
      }
      const jobId = extractEnterpriseJobId(res);
      const full = res.reply || "";
      const id = newMessageId();
      const base: AuraChatMessageModel = {
        id,
        role: "aura",
        text: jobId ? full : "",
        fullText: full,
        actions: res.actions,
        navigation: res.navigation,
        approvals: res.approvalsCreated,
        progress: jobId ? 2 : undefined,
        jobId,
        jobStatus: jobId ? "queued" : undefined,
        streaming: !jobId && full.length > 40,
        collapsed: shouldCollapse(full),
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, base]);
      if (jobId) setJobTracking({ jobId, messageId: id });
      scrollToEnd(true);

      if (!jobId && full.length > 40) {
        const stop = revealStreamingText(full, (partial, done) => {
          updateMessage(id, { text: partial, streaming: !done });
          scrollToEnd();
        });
        streamCleanups.current.push(stop);
      } else if (!jobId) {
        updateMessage(id, { text: full, streaming: false });
      }
    },
    [scrollToEnd, updateMessage]
  );

  useEffect(() => {
    if (!jobTracking) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { job, narrative } = await grantsApi.enterpriseFundingJob(jobTracking.jobId);
        if (cancelled) return;
        const running = job.status === "queued" || job.status === "running";
        const progressText = running
          ? `${job.message}\n\n── Live status ──\nProgress: ${job.progress}%\nPhase: ${job.phase.replace(/_/g, " ")}\nJob ID: ${job.jobId}`
          : narrative;
        updateMessage(jobTracking.messageId, {
          text: progressText,
          fullText: progressText,
          progress: job.progress,
          phase: job.phase,
          jobStatus: job.status,
          streaming: running,
          collapsed: shouldCollapse(progressText),
          error: job.status === "failed",
        });
        scrollToEnd();
        if (!running) setJobTracking(null);
      } catch {
        /* keep polling — job continues server-side */
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobTracking, scrollToEnd, updateMessage]);

  useEffect(() => () => streamCleanups.current.forEach((fn) => fn()), []);

  const runCommand = useCallback(
    async (text: string) => {
      const command = text.trim();
      if (!command || loading) return;
      setInput("");
      setMessages((prev) => [
        ...prev,
        { id: newMessageId(), role: "user", text: command, createdAt: new Date().toISOString() },
      ]);
      setLoading(true);
      scrollToEnd(true);
      try {
        const res = await hqApi.auraCommand(command, {
          module: moduleRef.current,
          contextRef: contextRefBox.current,
        });
        applyResponse(res);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: newMessageId(),
            role: "aura",
            text: err instanceof Error ? err.message : "AURA is unavailable right now.",
            error: true,
            createdAt: new Date().toISOString(),
          },
        ]);
        scrollToEnd(true);
      } finally {
        setLoading(false);
      }
    },
    [applyResponse, loading, scrollToEnd]
  );

  const runAction = useCallback(
    async (actionId: string, args?: Record<string, unknown>, label?: string) => {
      if (loading) return;
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: "user",
          text: label ? String(label) : `Run ${actionId}`,
          createdAt: new Date().toISOString(),
        },
      ]);
      setLoading(true);
      scrollToEnd(true);
      try {
        const res = await hqApi.auraAction(actionId, {
          args,
          module: moduleRef.current,
          contextRef: contextRefBox.current,
        });
        applyResponse(res);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: newMessageId(),
            role: "aura",
            text: err instanceof Error ? err.message : "AURA action failed.",
            error: true,
            createdAt: new Date().toISOString(),
          },
        ]);
        scrollToEnd(true);
      } finally {
        setLoading(false);
      }
    },
    [applyResponse, loading, scrollToEnd]
  );

  useEffect(() => {
    if (!autoCommand || autoRan.current) return;
    autoRan.current = true;
    if (autoCommand.actionId) {
      void runAction(autoCommand.actionId, autoCommand.args, autoCommand.label ?? autoCommand.text);
    } else if (autoCommand.text) {
      void runCommand(autoCommand.text);
    }
  }, [autoCommand, runAction, runCommand]);

  const goTo = useCallback(
    (path: string) => {
      onClose?.();
      navigate(path);
    },
    [navigate, onClose]
  );

  const clearMemory = useCallback(async () => {
    setMessages([]);
    setJobTracking(null);
    try {
      await hqApi.auraMemoryReset();
    } catch {
      /* non-blocking */
    }
  }, []);

  const continueGenerating = useCallback(
    (msg: AuraChatMessageModel) => {
      const full = msg.fullText ?? msg.text;
      const nextLen = Math.min(full.length, msg.text.length + CONTINUE_CHUNK_CHARS);
      const next = full.slice(0, nextLen);
      updateMessage(msg.id, {
        text: next,
        streaming: nextLen < full.length,
        collapsed: false,
      });
      scrollToEnd(true);
    },
    [scrollToEnd, updateMessage]
  );

  const visibleText = useCallback((msg: AuraChatMessageModel) => {
    const source = msg.text;
    if (msg.collapsed && !msg.streaming && source.length > LONG_REPORT_COLLAPSE_CHARS) {
      return `${source.slice(0, LONG_REPORT_COLLAPSE_CHARS)}\n\n…`;
    }
    return source;
  }, []);

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

  const voiceSupported = Boolean(getSpeechRecognition());
  const activeJob = useMemo(
    () => messages.find((m) => m.jobId && (m.jobStatus === "queued" || m.jobStatus === "running")),
    [messages]
  );

  return (
    <div className={`hq-aura-workspace hq-aura-workspace-${variant}${className ? ` ${className}` : ""}`}>
      <header className="hq-aura-workspace-header">
        <div className="hq-aura-workspace-title">
          <Sparkles size={16} />
          <span>AURA</span>
          <span className="hq-aura-cmd-badge">Executive Workspace</span>
          {founderMode ? (
            <span className="hq-aura-job-pill" title={identityLabel || "Founder Mode"}>
              Founder Mode
            </span>
          ) : identityLabel ? (
            <span className="hq-aura-cmd-badge">{identityLabel}</span>
          ) : null}
          {activeJob && (
            <span className="hq-aura-job-pill" title={activeJob.jobId}>
              <Loader2 size={12} className="hq-spin" />
              Job {activeJob.progress ?? 0}%
            </span>
          )}
        </div>
        <div className="hq-aura-cmd-header-actions">
          <button type="button" className="hq-aura-cmd-icon" onClick={clearMemory} title="Clear conversation" aria-label="Clear conversation">
            <Eraser size={15} />
          </button>
          {onClose && (
            <button type="button" className="hq-aura-cmd-icon" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="hq-aura-workspace-scroll" ref={scrollRef} onScroll={onScrollBody}>
        {messages.length === 0 && !loading && (
          <div className="hq-aura-cmd-empty">
            <ShieldCheck size={22} />
            <p>
              IFCDC Headquarters command center. AURA drafts, searches, and prepares — nothing is submitted without founder approval.
            </p>
            <div className="hq-aura-suggestions">
              {suggestions.map((s) => (
                <button key={s} type="button" className="hq-aura-suggestion" onClick={() => void runCommand(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const full = m.fullText ?? m.text;
          const canContinue = Boolean(m.fullText && m.text.length < m.fullText.length && !m.streaming);
          const showCollapse = shouldCollapse(full) && !m.streaming;
          return (
            <article key={m.id} className={`hq-aura-msg ${m.role}`}>
              <div className={`hq-aura-bubble hq-aura-bubble-workspace ${m.error ? "hq-aura-bubble-error" : ""}`}>
                <div className="hq-aura-bubble-body">{visibleText(m)}{m.streaming ? " ▍" : ""}</div>

                {typeof m.progress === "number" && (m.jobStatus === "queued" || m.jobStatus === "running") && (
                  <div className="hq-aura-progress">
                    <div className="hq-aura-progress-meta">
                      <span>{m.phase?.replace(/_/g, " ") || "Enterprise scan"}</span>
                      <span>{m.progress}%</span>
                    </div>
                    <div className="hq-aura-progress-track">
                      <div className="hq-aura-progress-fill" style={{ width: `${Math.max(4, m.progress)}%` }} />
                    </div>
                    {m.jobId && <div className="hq-aura-job-id">Job ID: {m.jobId}</div>}
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

                {m.role === "aura" && !m.error && (
                  <div className="hq-aura-msg-toolbar">
                    {showCollapse && (
                      <button
                        type="button"
                        className="hq-aura-tool-btn"
                        onClick={() => updateMessage(m.id, { collapsed: !m.collapsed })}
                      >
                        {m.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        {m.collapsed ? "Expand" : "Collapse"}
                      </button>
                    )}
                    {canContinue && (
                      <button type="button" className="hq-aura-tool-btn primary" onClick={() => continueGenerating(m)}>
                        Continue Generating
                      </button>
                    )}
                    <button
                      type="button"
                      className="hq-aura-tool-btn"
                      onClick={async () => {
                        await copyAuraText(full);
                        showToast("Copied to clipboard");
                      }}
                    >
                      <Copy size={14} /> Copy
                    </button>
                    <button
                      type="button"
                      className="hq-aura-tool-btn"
                      onClick={() => {
                        exportAuraReportPdf("AURA Executive Funding Report", full);
                        showToast("Opening print / PDF dialog");
                      }}
                    >
                      <FileText size={14} /> Export PDF
                    </button>
                    <button
                      type="button"
                      className="hq-aura-tool-btn"
                      onClick={() => {
                        exportAuraReportMarkdown("AURA Executive Funding Report", full);
                        showToast("Markdown downloaded");
                      }}
                    >
                      <Download size={14} /> Export MD
                    </button>
                    <button
                      type="button"
                      className="hq-aura-tool-btn"
                      onClick={() => {
                        saveAuraReport({
                          title: "AURA Executive Report",
                          body: full,
                          jobId: m.jobId,
                        });
                        showToast("Report saved locally");
                      }}
                    >
                      <Save size={14} /> Save Report
                    </button>
                    <button
                      type="button"
                      className="hq-aura-tool-btn"
                      onClick={() =>
                        goTo(
                          m.jobId
                            ? `/hq/grants?tab=pipeline&enterpriseJob=${m.jobId}`
                            : m.navigation?.path || "/hq/grants?tab=pipeline"
                        )
                      }
                    >
                      <FolderOpen size={14} /> Open in Workspace
                    </button>
                  </div>
                )}
              </div>
            </article>
          );
        })}

        {loading && (
          <div className="hq-aura-msg aura">
            <div className="hq-aura-bubble hq-aura-thinking">
              <Loader2 size={15} className="hq-spin" /> AURA is thinking…
            </div>
          </div>
        )}
        <div ref={endRef} className="hq-aura-scroll-anchor" />
      </div>

      {!stickToBottom && (
        <button type="button" className="hq-aura-jump-latest" onClick={() => scrollToEnd(true)}>
          Jump to latest
        </button>
      )}

      {toast && <div className="hq-aura-toast">{toast}</div>}

      <form
        className="hq-aura-workspace-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void runCommand(input);
        }}
      >
        <textarea
          ref={inputRef}
          className="hq-aura-workspace-input"
          placeholder="Command AURA — enterprise scan, drafts, briefings…"
          value={input}
          rows={1}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void runCommand(input);
            }
          }}
          disabled={loading}
        />
        {voiceSupported && (
          <button
            type="button"
            className={`hq-aura-cmd-icon ${listening ? "listening" : ""}`}
            onClick={toggleVoice}
            aria-label={listening ? "Stop listening" : "Speak a command"}
          >
            <Mic size={16} />
          </button>
        )}
        <button type="submit" className="hq-aura-send" disabled={loading || !input.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

export default AuraExecutiveChatWorkspace;
