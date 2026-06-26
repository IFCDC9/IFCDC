import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap, CheckCircle2, Download, Copy, Check, Key, Terminal } from "lucide-react";
import { developerApi, type OnboardResult } from "../../api/developerApi";
import { StatusBadge } from "./StatusBadge";

const APP_TEMPLATES = [
  { id: "music-app", name: "IFCDC Music", healthUrl: "http://localhost:5001/api/health", launchUrl: "http://localhost:5001" },
  { id: "radio-app", name: "IFCDC Radio", healthUrl: "http://localhost:5000/api/health", launchUrl: "http://localhost:5000/radio" },
  { id: "tapis-app", name: "IFCDC Tapis", healthUrl: "http://localhost:5002/api/health", launchUrl: "http://localhost:5002" },
  { id: "inclusive-app", name: "Inclusive Community", healthUrl: "http://localhost:5003/api/health", launchUrl: "http://localhost:5003" },
  { id: "swiftware-app", name: "Swift-Ware", healthUrl: "http://localhost:5004/api/health", launchUrl: "http://localhost:5004" },
  { id: "cryptocoin-app", name: "CryptoCoin IFCDC", healthUrl: "http://localhost:5005/api/health", launchUrl: "http://localhost:5005" },
];

export const QuickRegisterPanel: React.FC = () => {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [healthUrl, setHealthUrl] = useState("");
  const [launchUrl, setLaunchUrl] = useState("");
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const register = useMutation({
    mutationFn: developerApi.quickRegister,
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["hq-software-division"] });
      queryClient.invalidateQueries({ queryKey: ["hq-registered-apps"] });
    },
  });

  const applyTemplate = (t: typeof APP_TEMPLATES[0]) => {
    setId(t.id);
    setName(t.name);
    setHealthUrl(t.healthUrl);
    setLaunchUrl(t.launchUrl);
    setResult(null);
  };

  const canRegister = id && name && healthUrl.startsWith("http");

  const downloadSetupScript = () => {
    const script = result?.sdkSetup?.setupScript;
    if (!script) return;
    const blob = new Blob([script], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `setup-ifcdc-hq-${result!.credentials.appId}.sh`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadEnv = () => {
    if (!result?.envFile) return;
    const blob = new Blob([result.envFile], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `.env.${result.credentials.appId}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyEnv = () => {
    if (!result?.envFile) return;
    navigator.clipboard.writeText(result.envFile);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (result) {
    return (
      <div className="hq-quick-register hq-fade-in">
        <div className="hq-quick-register-success">
          <CheckCircle2 size={36} color="#22c55e" />
          <h3>{result.app.name} registered</h3>
          <p>Credentials provisioned — all enterprise services inherited automatically.</p>
          <div className="hq-onboard-credentials">
            <div><Key size={16} /> App ID: <code>{result.credentials.appId}</code></div>
            <div className="hq-onboard-api-key">
              <strong>API Key:</strong>
              <code>{result.credentials.apiKey}</code>
            </div>
            <StatusBadge label="Shown once — save now" variant="warning" />
          </div>
          {result.envFile && (
            <div className="hq-quick-register-env">
              <CopyBlock text={result.envFile} />
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.65rem", flexWrap: "wrap" }}>
                <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={downloadEnv}>
                  <Download size={14} /> Download .env
                </button>
                {result.sdkSetup?.setupScript && (
                  <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={downloadSetupScript}>
                    <Terminal size={14} /> Download setup script
                  </button>
                )}
                <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={copyEnv}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} Copy
                </button>
              </div>
              {result.sdkSetup && (
                <p className="hq-muted-text" style={{ marginTop: "0.65rem", fontSize: "0.78rem" }}>
                  Next: run <code>{result.sdkSetup.install}</code> or use the setup script, then validate environment before deploy.
                </p>
              )}
            </div>
          )}
          <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" style={{ marginTop: "1rem" }} onClick={() => setResult(null)}>
            Register another app
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hq-quick-register hq-fade-in">
      <div className="hq-quick-register-header">
        <Zap size={22} />
        <div>
          <h3>One-Click Registration</h3>
          <p>Register instantly — API key, credentials, and full enterprise service inheritance provisioned automatically.</p>
        </div>
      </div>

      <div className="hq-quick-templates">
        <span className="hq-muted-text" style={{ fontSize: "0.78rem", marginBottom: "0.5rem", display: "block" }}>Quick templates:</span>
        <div className="hq-quick-template-grid">
          {APP_TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="hq-quick-template-btn" onClick={() => applyTemplate(t)}>
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="hq-form-grid" style={{ marginTop: "1rem" }}>
        <label className="hq-field">
          <span>App ID</span>
          <input className="hq-input" value={id} onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="music-app" />
        </label>
        <label className="hq-field">
          <span>App Name</span>
          <input className="hq-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="IFCDC Music" />
        </label>
        <label className="hq-field hq-field-full">
          <span>Health URL</span>
          <input className="hq-input" value={healthUrl} onChange={(e) => setHealthUrl(e.target.value)} placeholder="https://app.ifcdc.org/api/health" />
        </label>
        <label className="hq-field hq-field-full">
          <span>Launch URL (optional)</span>
          <input className="hq-input" value={launchUrl} onChange={(e) => setLaunchUrl(e.target.value)} placeholder="https://app.ifcdc.org" />
        </label>
      </div>

      {register.isError && <p style={{ color: "#ef4444", fontSize: "0.85rem" }}>{(register.error as Error).message}</p>}

      <button
        type="button"
        className="hq-btn hq-btn-primary hq-quick-register-btn"
        disabled={!canRegister || register.isPending}
        onClick={() => register.mutate({ id, name, healthUrl, launchUrl: launchUrl || undefined })}
      >
        <Zap size={16} />
        {register.isPending ? "Provisioning credentials…" : "Register & Provision Credentials"}
      </button>
    </div>
  );
};

function CopyBlock({ text }: { text: string }) {
  return <pre className="hq-env-preview">{text}</pre>;
}
