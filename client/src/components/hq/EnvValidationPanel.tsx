import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheck, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { developerApi, type EnvValidationResult } from "../../api/developerApi";
import { StatusBadge } from "./StatusBadge";

export const EnvValidationPanel: React.FC = () => {
  const [appId, setAppId] = useState("");
  const [healthUrl, setHealthUrl] = useState("");
  const [launchUrl, setLaunchUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [sdkVersion, setSdkVersion] = useState("1.3.0");
  const [result, setResult] = useState<EnvValidationResult | null>(null);

  const validate = useMutation({
    mutationFn: developerApi.validateEnvironment,
    onSuccess: setResult,
  });

  const canValidate = appId && healthUrl.startsWith("http");

  return (
    <div className="hq-env-validation hq-fade-in">
      <div className="hq-quick-register-header">
        <ShieldCheck size={22} />
        <div>
          <h3>Environment Validation</h3>
          <p>Verify health endpoint, credentials, and SDK compatibility before deployment.</p>
        </div>
      </div>

      <div className="hq-form-grid" style={{ marginTop: "1rem" }}>
        <label className="hq-field">
          <span>App ID</span>
          <input className="hq-input" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="music-app" />
        </label>
        <label className="hq-field">
          <span>SDK Version</span>
          <input className="hq-input" value={sdkVersion} onChange={(e) => setSdkVersion(e.target.value)} placeholder="1.3.0" />
        </label>
        <label className="hq-field hq-field-full">
          <span>Health URL</span>
          <input className="hq-input" value={healthUrl} onChange={(e) => setHealthUrl(e.target.value)} placeholder="https://app.ifcdc.org/api/health" />
        </label>
        <label className="hq-field hq-field-full">
          <span>Launch URL (optional)</span>
          <input className="hq-input" value={launchUrl} onChange={(e) => setLaunchUrl(e.target.value)} placeholder="https://app.ifcdc.org" />
        </label>
        <label className="hq-field hq-field-full">
          <span>API Key (optional — verifies credentials)</span>
          <input className="hq-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="ifcdc_music-app_..." />
        </label>
      </div>

      {validate.isError && <p style={{ color: "#ef4444", fontSize: "0.85rem" }}>{(validate.error as Error).message}</p>}

      <button
        type="button"
        className="hq-btn hq-btn-primary hq-quick-register-btn"
        disabled={!canValidate || validate.isPending}
        onClick={() => validate.mutate({ appId, healthUrl, launchUrl: launchUrl || undefined, apiKey: apiKey || undefined, sdkVersion })}
      >
        <ShieldCheck size={16} />
        {validate.isPending ? "Validating…" : "Run Environment Validation"}
      </button>

      {result && (
        <div className="hq-env-validation-result" style={{ marginTop: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
            {result.valid ? <CheckCircle size={24} color="#22c55e" /> : <AlertTriangle size={24} color="#f59e0b" />}
            <div>
              <strong>{result.valid ? "Ready for deployment" : "Validation issues found"}</strong>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.35rem" }}>
                <StatusBadge label={`Score ${result.score}%`} variant={result.valid ? "success" : "warning"} />
                <StatusBadge label={`SDK v${result.sdkVersion}`} variant="muted" />
                <StatusBadge label={result.compatible ? "Compatible" : "Incompatible"} variant={result.compatible ? "success" : "danger"} />
              </div>
            </div>
          </div>
          <div className="hq-diagnostics-checks">
            {result.checks.map((check) => (
              <div key={check.id} className={`hq-diagnostics-check ${check.passed ? "pass" : "fail"}`}>
                {check.passed ? <CheckCircle size={14} /> : <XCircle size={14} />}
                <div>
                  <strong>{check.label}</strong>
                  <span className="hq-muted-text">{check.message}</span>
                  <StatusBadge label={check.severity} variant="muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
