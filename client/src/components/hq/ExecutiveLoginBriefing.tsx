import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, X, ChevronRight } from "lucide-react";
import { phase9Api } from "../../api/phase9Api";
import { StatusBadge } from "./StatusBadge";
import { useAuth } from "../../auth/AuthContext";

const DISMISS_KEY = "ifcdc-hq-briefing-dismissed";

export const ExecutiveLoginBriefing: React.FC = () => {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => {
    try {
      const stored = sessionStorage.getItem(DISMISS_KEY);
      return stored === new Date().toDateString();
    } catch {
      return false;
    }
  });

  const { data } = useQuery({
    queryKey: ["phase9-login-briefing"],
    queryFn: phase9Api.loginBriefing,
    staleTime: 300_000,
    enabled: !dismissed && Boolean(user),
  });

  useEffect(() => {
    if (dismissed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissed]);

  function dismiss() {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, new Date().toDateString()); } catch { /* ignore */ }
  }

  if (dismissed || !data) return null;

  return (
    <div className="hq-login-briefing hq-fade-in" role="dialog" aria-label="Executive briefing">
      <div className="hq-login-briefing-inner">
        <button type="button" className="hq-login-briefing-close" onClick={dismiss} aria-label="Dismiss briefing">
          <X size={16} />
        </button>
        <div className="hq-login-briefing-header">
          <Sparkles size={18} style={{ color: "var(--hq-gold)" }} />
          <div>
            <p className="hq-login-briefing-eyebrow">AURA Executive Briefing</p>
            <h3>{data.greeting}</h3>
          </div>
          <StatusBadge label={`Health ${data.organizationHealth.overall}%`} variant="success" />
        </div>
        <ul className="hq-login-briefing-highlights">
          {data.highlights.slice(0, 4).map((h) => <li key={h}>{h}</li>)}
        </ul>
        {data.priorities.length > 0 && (
          <div className="hq-login-briefing-priorities">
            <strong>Today's priorities</strong>
            <ul>{data.priorities.slice(0, 3).map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        <div className="hq-login-briefing-actions">
          <Link to="/hq/phase9" className="hq-btn hq-btn-primary hq-btn-sm" onClick={dismiss}>
            Intelligent OS <ChevronRight size={14} />
          </Link>
          <Link to="/hq/aura" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={dismiss}>AURA Command Center</Link>
          <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={dismiss}>Continue to Dashboard</button>
        </div>
      </div>
    </div>
  );
};
