import React, { useState } from "react";
import { X, Rocket } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { softwareDivisionApi } from "../../../api/softwareDivisionApi";

export const SoftwareDivisionRegisterModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const qc = useQueryClient();
  const [form, setForm] = useState({ id: "", name: "", healthUrl: "", launchUrl: "", description: "" });
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: () =>
      softwareDivisionApi.register({
        id: form.id.trim(),
        name: form.name.trim(),
        healthUrl: form.healthUrl.trim(),
        launchUrl: form.launchUrl.trim() || undefined,
        description: form.description.trim() || undefined,
      }),
    onSuccess: (data) => {
      setApiKey(data.credentials.apiKey);
      void qc.invalidateQueries({ queryKey: ["hq-software-division"] });
      void qc.invalidateQueries({ queryKey: ["hq-registered-apps"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="hq-modal-overlay" onClick={onClose} role="presentation">
      <div className="hq-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="hq-diagnostics-header">
          <h3><Rocket size={18} /> Register Application</h3>
          <button type="button" className="hq-widget-remove" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {apiKey ? (
          <div style={{ padding: "1rem" }}>
            <p style={{ color: "var(--hq-gold)", fontWeight: 600 }}>Application registered</p>
            <p className="hq-muted-text" style={{ fontSize: "0.85rem" }}>Copy the API key now — it will not be shown again.</p>
            <code className="hq-code-block" style={{ display: "block", marginTop: "0.75rem", wordBreak: "break-all" }}>{apiKey}</code>
            <button type="button" className="hq-btn hq-btn-primary" style={{ marginTop: "1rem" }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <form
            style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}
            onSubmit={(e) => { e.preventDefault(); setError(null); register.mutate(); }}
          >
            <input className="hq-input" placeholder="App ID (e.g. my-app)" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} required />
            <input className="hq-input" placeholder="Display name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="hq-input" placeholder="Health URL" value={form.healthUrl} onChange={(e) => setForm({ ...form, healthUrl: e.target.value })} required />
            <input className="hq-input" placeholder="Launch URL (optional)" value={form.launchUrl} onChange={(e) => setForm({ ...form, launchUrl: e.target.value })} />
            <textarea className="hq-input" placeholder="Description (optional)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            {error && <p style={{ color: "#ef4444", fontSize: "0.85rem" }}>{error}</p>}
            <button type="submit" className="hq-btn hq-btn-primary" disabled={register.isPending || !form.id || !form.name || !form.healthUrl}>
              {register.isPending ? "Registering…" : "Register App"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
