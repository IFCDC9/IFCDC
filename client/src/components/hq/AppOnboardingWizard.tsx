import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Rocket, Key, Plug, CheckCircle2, ChevronRight, ChevronLeft, AlertTriangle } from "lucide-react";
import { developerApi, type OnboardResult } from "../../api/developerApi";
import { StatusBadge } from "./StatusBadge";

const INHERITED_SERVICES = [
  { id: "auth", label: "Enterprise Authentication" },
  { id: "people", label: "People & HR Database" },
  { id: "finance", label: "Financial Engine" },
  { id: "grants", label: "Grant Center" },
  { id: "analytics", label: "Organization Analytics" },
  { id: "aura", label: "AURA AI" },
  { id: "notifications", label: "Enterprise Notifications" },
  { id: "operations", label: "Operations Modules" },
];

const STEPS = ["Application Info", "Endpoints", "Services", "Credentials", "Complete"];

export const AppOnboardingWizard: React.FC = () => {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    id: "",
    name: "",
    description: "",
    healthUrl: "",
    launchUrl: "",
    inheritedServices: ["auth", "analytics", "notifications"] as string[],
  });
  const [result, setResult] = useState<OnboardResult | null>(null);
  const queryClient = useQueryClient();

  const onboard = useMutation({
    mutationFn: developerApi.onboard,
    onSuccess: (data) => {
      setResult(data);
      setStep(4);
      queryClient.invalidateQueries({ queryKey: ["hq-software-division"] });
    },
  });

  const toggleService = (id: string) => {
    setForm((f) => ({
      ...f,
      inheritedServices: f.inheritedServices.includes(id)
        ? f.inheritedServices.filter((s) => s !== id)
        : [...f.inheritedServices, id],
    }));
  };

  const canNext = () => {
    if (step === 0) return form.id && form.name && /^[a-z0-9-]+$/.test(form.id);
    if (step === 1) return form.healthUrl.startsWith("http");
    if (step === 2) return form.inheritedServices.length > 0;
    return true;
  };

  const submit = () => {
    onboard.mutate(form);
  };

  return (
    <div className="hq-onboard-wizard hq-fade-in">
      <div className="hq-onboard-header">
        <Rocket size={22} />
        <div>
          <h3>Application Onboarding Wizard</h3>
          <p>Register a new IFCDC application with Headquarters — receive API credentials and appear in Software Division automatically.</p>
        </div>
      </div>

      <div className="hq-onboard-steps">
        {STEPS.map((label, i) => (
          <div key={label} className={`hq-onboard-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
            <span className="hq-onboard-step-num">{i < step ? "✓" : i + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="hq-onboard-body">
        {step === 0 && (
          <div className="hq-form-grid">
            <label className="hq-field">
              <span>Application ID</span>
              <input className="hq-input" placeholder="music-app" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
              <small>Lowercase, hyphens only — e.g. music-app, tapis-app</small>
            </label>
            <label className="hq-field">
              <span>Application Name</span>
              <input className="hq-input" placeholder="IFCDC Music" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="hq-field hq-field-full">
              <span>Description</span>
              <textarea className="hq-input" rows={3} placeholder="What does this application do?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="hq-form-grid">
            <label className="hq-field hq-field-full">
              <span>Health Check URL</span>
              <input className="hq-input" placeholder="https://music.ifcdc.org/api/health" value={form.healthUrl} onChange={(e) => setForm({ ...form, healthUrl: e.target.value })} />
            </label>
            <label className="hq-field hq-field-full">
              <span>Launch URL (optional)</span>
              <input className="hq-input" placeholder="https://music.ifcdc.org" value={form.launchUrl} onChange={(e) => setForm({ ...form, launchUrl: e.target.value })} />
            </label>
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="hq-muted-text" style={{ marginBottom: "1rem" }}>Select enterprise services your application will inherit from Headquarters:</p>
            <div className="hq-onboard-services">
              {INHERITED_SERVICES.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  className={`hq-onboard-service ${form.inheritedServices.includes(svc.id) ? "selected" : ""}`}
                  onClick={() => toggleService(svc.id)}
                >
                  <Plug size={16} />
                  {svc.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="hq-onboard-review">
            <p>Review and register <strong>{form.name}</strong> ({form.id}) with Headquarters.</p>
            <ul className="hq-dev-list">
              <li>Health: <code>{form.healthUrl}</code></li>
              {form.launchUrl && <li>Launch: <code>{form.launchUrl}</code></li>}
              <li>Services: {form.inheritedServices.join(", ")}</li>
            </ul>
            <div className="hq-onboard-warning">
              <AlertTriangle size={16} />
              The Barbers App is production locked and cannot be registered through this wizard.
            </div>
            {onboard.isError && <p style={{ color: "#ef4444" }}>{(onboard.error as Error).message}</p>}
          </div>
        )}

        {step === 4 && result && (
          <div className="hq-onboard-success">
            <CheckCircle2 size={32} color="#22c55e" />
            <h4>{result.app.name} is registered!</h4>
            <p>Your application will appear in the Software Division dashboard.</p>
            <div className="hq-onboard-credentials">
              <div><Key size={16} /> <strong>App ID:</strong> <code>{result.credentials.appId}</code></div>
              <div className="hq-onboard-api-key">
                <strong>API Key (save now — shown once):</strong>
                <code>{result.credentials.apiKey}</code>
              </div>
              <StatusBadge label={result.credentials.warning} variant="warning" />
            </div>
            {result.envFile && (
              <div className="hq-quick-register-env" style={{ marginTop: "1rem" }}>
                <strong style={{ fontSize: "0.85rem" }}>.env configuration:</strong>
                <pre className="hq-env-preview">{result.envFile}</pre>
              </div>
            )}
            <div className="hq-onboard-next">
              <strong>Next steps:</strong>
              <ol>{result.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
          </div>
        )}
      </div>

      <div className="hq-onboard-actions">
        {step > 0 && step < 4 && (
          <button type="button" className="hq-btn hq-btn-ghost" onClick={() => setStep(step - 1)}>
            <ChevronLeft size={14} /> Back
          </button>
        )}
        {step < 3 && (
          <button type="button" className="hq-btn hq-btn-primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>
            Next <ChevronRight size={14} />
          </button>
        )}
        {step === 3 && (
          <button type="button" className="hq-btn hq-btn-primary" disabled={onboard.isPending} onClick={submit}>
            {onboard.isPending ? "Registering…" : "Register Application"}
          </button>
        )}
        {step === 4 && (
          <button type="button" className="hq-btn hq-btn-secondary" onClick={() => { setStep(0); setResult(null); setForm({ id: "", name: "", description: "", healthUrl: "", launchUrl: "", inheritedServices: ["auth", "analytics", "notifications"] }); }}>
            Register Another App
          </button>
        )}
      </div>
    </div>
  );
};
