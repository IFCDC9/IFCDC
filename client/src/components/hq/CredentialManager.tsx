import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Key, RefreshCw, Download, Copy, Check, AlertTriangle } from "lucide-react";
import { developerApi } from "../../api/developerApi";
import { HqPanel } from "./HqPanel";
import { StatusBadge } from "./StatusBadge";

export const CredentialManager: React.FC = () => {
  const queryClient = useQueryClient();
  const [rotatedKey, setRotatedKey] = useState<{ appId: string; apiKey: string; envFile: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["hq-registered-apps"],
    queryFn: developerApi.registeredApps,
  });

  const rotate = useMutation({
    mutationFn: (appId: string) => developerApi.rotateKey(appId),
    onSuccess: (res) => {
      setRotatedKey({ appId: res.appId, apiKey: res.apiKey, envFile: res.envFile });
      queryClient.invalidateQueries({ queryKey: ["hq-registered-apps"] });
    },
  });

  const downloadEnv = () => {
    if (!rotatedKey) return;
    const blob = new Blob([rotatedKey.envFile], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `.env.${rotatedKey.appId}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyKey = () => {
    if (!rotatedKey) return;
    navigator.clipboard.writeText(rotatedKey.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return <p className="hq-muted-text">Loading credentials…</p>;

  return (
    <div className="hq-credential-manager hq-fade-in">
      <HqPanel title="Enterprise Credential Management" subtitle="API keys for registered applications — rotate when compromised">
        {rotatedKey && (
          <div className="hq-onboard-credentials" style={{ marginBottom: "1.25rem" }}>
            <StatusBadge label="New key — shown once" variant="warning" />
            <div className="hq-onboard-api-key" style={{ marginTop: "0.75rem" }}>
              <strong>{rotatedKey.appId}:</strong>
              <code>{rotatedKey.apiKey}</code>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.65rem" }}>
              <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={downloadEnv}>
                <Download size={14} /> Download .env
              </button>
              <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={copyKey}>
                {copied ? <Check size={14} /> : <Copy size={14} />} Copy key
              </button>
              <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => setRotatedKey(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {!data?.apps.length ? (
          <p className="hq-muted-text">No registered applications yet. Use one-click registration to provision credentials.</p>
        ) : (
          <div className="hq-dev-endpoint-table">
            {data.apps.map((app) => (
              <div key={app.id} className="hq-dev-endpoint-row" style={{ alignItems: "center" }}>
                <div>
                  <strong>{app.name}</strong>
                  <div className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{app.id}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <code><Key size={12} /> {app.apiKeyPrefix}…</code>
                  <StatusBadge label={app.status} variant={app.status === "active" ? "success" : "muted"} />
                  <button
                    type="button"
                    className="hq-btn hq-btn-secondary hq-btn-sm"
                    disabled={rotate.isPending}
                    onClick={() => {
                      if (window.confirm(`Rotate API key for ${app.name}? Previous key will stop working immediately.`)) {
                        rotate.mutate(app.id);
                      }
                    }}
                  >
                    <RefreshCw size={14} /> Rotate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {rotate.isError && (
          <p style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.75rem" }}>
            <AlertTriangle size={14} /> {(rotate.error as Error).message}
          </p>
        )}
      </HqPanel>
    </div>
  );
};
