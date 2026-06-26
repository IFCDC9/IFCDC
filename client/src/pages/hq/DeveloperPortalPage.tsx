import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Code2, Plug, Radio, Copy, Check, Terminal, Rocket, Shield, GitBranch } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi } from "../../api/hqApi";
import { developerApi } from "../../api/developerApi";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqPanel } from "../../components/hq/HqPanel";
import { AppOnboardingWizard } from "../../components/hq/AppOnboardingWizard";
import { QuickRegisterPanel } from "../../components/hq/QuickRegisterPanel";
import { EnvValidationPanel } from "../../components/hq/EnvValidationPanel";
import { CredentialManager } from "../../components/hq/CredentialManager";
import { SecurityAuditPanel } from "../../components/hq/SecurityAuditPanel";

type Tab = "onboard" | "credentials" | "validate" | "docs" | "api" | "security" | "versions";

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="hq-code-block">
      <button type="button" className="hq-code-copy" onClick={copy} aria-label="Copy">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre>{text}</pre>
    </div>
  );
}

const DeveloperPortalPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>("onboard");

  const framework = useQuery({
    queryKey: ["hq-software-division-framework"],
    queryFn: hqApi.softwareDivisionFramework,
  });

  const docs = useQuery({
    queryKey: ["hq-developer-docs"],
    queryFn: developerApi.documentation,
  });

  const compatibility = useQuery({
    queryKey: ["hq-developer-compatibility"],
    queryFn: developerApi.compatibility,
  });

  const registered = useQuery({
    queryKey: ["hq-registered-apps"],
    queryFn: developerApi.registeredApps,
  });

  return (
    <HQLayout title="Developer Portal" subtitle="Onboard applications, SDK documentation, and Headquarters API reference">
      <div className="hq-dev-hero hq-fade-in">
        <BookOpen size={28} />
        <div>
          <h2>IFCDC Headquarters Developer Portal</h2>
          <p>Register new applications, receive API credentials, and plug into the enterprise platform in minutes — auth, HR, finance, grants, analytics, AURA, and notifications.</p>
        </div>
        <StatusBadge label="Barbers App: Production Locked" variant="locked" />
      </div>

      <div className="hq-tabs">
        <button type="button" className={`hq-tab ${tab === "onboard" ? "active" : ""}`} onClick={() => setTab("onboard")}>
          <Rocket size={16} /> Onboard App
        </button>
        <button type="button" className={`hq-tab ${tab === "credentials" ? "active" : ""}`} onClick={() => setTab("credentials")}>
          <KeyIcon /> Credentials
        </button>
        <button type="button" className={`hq-tab ${tab === "validate" ? "active" : ""}`} onClick={() => setTab("validate")}>
          <Shield size={16} /> Validate
        </button>
        <button type="button" className={`hq-tab ${tab === "docs" ? "active" : ""}`} onClick={() => setTab("docs")}>
          <BookOpen size={16} /> SDK & Guides
        </button>
        <button type="button" className={`hq-tab ${tab === "api" ? "active" : ""}`} onClick={() => setTab("api")}>
          <Terminal size={16} /> API Reference
        </button>
        <button type="button" className={`hq-tab ${tab === "versions" ? "active" : ""}`} onClick={() => setTab("versions")}>
          <GitBranch size={16} /> Versions
        </button>
        <button type="button" className={`hq-tab ${tab === "security" ? "active" : ""}`} onClick={() => setTab("security")}>
          <Shield size={16} /> Security
        </button>
      </div>

      {tab === "credentials" && <CredentialManager />}

      {tab === "validate" && <EnvValidationPanel />}

      {tab === "onboard" && (
        <div className="hq-fade-in">
          <QuickRegisterPanel />
          <details className="hq-advanced-wizard">
            <summary>Advanced onboarding wizard</summary>
            <AppOnboardingWizard />
          </details>
          {registered.data && registered.data.apps.length > 0 && (
            <HqPanel title="Registered Applications" subtitle="Dynamically onboarded via Developer Portal" className="hq-mt-panel">
              <div className="hq-dev-endpoint-table">
                {registered.data.apps.map((app) => (
                  <div key={app.id} className="hq-dev-endpoint-row">
                    <span>{app.name}</span>
                    <code>{app.id} · {app.apiKeyPrefix} · {app.status}</code>
                  </div>
                ))}
              </div>
            </HqPanel>
          )}
        </div>
      )}

      {tab === "docs" && docs.data && (
        <div className="hq-fade-in">
          <div className="hq-grid-2" style={{ marginBottom: "1.25rem" }}>
            <HqPanel title="Install SDK" subtitle={`@${docs.data.sdk.package} v${docs.data.sdk.version}`}>
              <CopyBlock text={docs.data.sdk.install} />
            </HqPanel>
            <HqPanel title="Platform Version" subtitle={`HQ v${docs.data.platformVersion}`}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <StatusBadge label={`SDK ${docs.data.sdk.version}`} variant="gold" />
                <StatusBadge label={`Platform ${docs.data.platformVersion}`} variant="muted" />
              </div>
              <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.82rem" }}>{docs.data.versioning.policy}</p>
            </HqPanel>
          </div>

          <HqPanel title="Quick Start">
            <CopyBlock text={docs.data.sdk.quickStart} />
          </HqPanel>

          {docs.data.implementationExamples?.map((ex) => (
            <HqPanel key={ex.id} title={ex.title} subtitle={ex.language} className="hq-mt-panel">
              <CopyBlock text={ex.code} />
            </HqPanel>
          ))}

          {docs.data.sampleProjects?.map((project) => (
            <HqPanel key={project.id} title={project.name} subtitle={project.stack} className="hq-mt-panel">
              <p className="hq-muted-text">{project.description}</p>
              <ol className="hq-dev-list" style={{ listStyle: "decimal", paddingLeft: "1.25rem", marginTop: "0.5rem" }}>
                {project.setupSteps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              <code className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{project.repoPath}</code>
            </HqPanel>
          ))}

          {docs.data.integrationGuides.map((guide) => (
            <HqPanel key={guide.id} title={guide.title} className="hq-mt-panel">
              <ol className="hq-dev-list" style={{ listStyle: "decimal", paddingLeft: "1.25rem" }}>
                {guide.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              {guide.example && <CopyBlock text={guide.example} />}
            </HqPanel>
          ))}
        </div>
      )}

      {tab === "api" && framework.data && (
        <div className="hq-fade-in">
          <HqPanel title="Inherited Services" subtitle={`Platform v${framework.data.version}`}>
            <div className="hq-framework-service-grid">
              {framework.data.inheritedServices.map((svc) => (
                <div key={svc.id} className="hq-framework-service-card">
                  <div className="hq-framework-service-name"><Plug size={14} /> {svc.name}</div>
                  <div className="hq-framework-service-desc">{svc.description}</div>
                  <code className="hq-framework-endpoint">{svc.endpoint}</code>
                </div>
              ))}
            </div>
          </HqPanel>

          <HqPanel title="API Endpoints" className="hq-mt-panel">
            <div className="hq-dev-endpoint-table">
              {[
                ["Quick Register", "POST /api/hq/developer/quick-register"],
                ["Validate Environment", "POST /api/hq/developer/validate-environment"],
                ["Rotate API Key", "POST /api/hq/developer/apps/:id/rotate-key"],
                ["SDK Setup Script", "GET /api/hq/developer/setup/:appId"],
                ["Security Monitor", "GET /api/hq/developer/security-monitor"],
                ["Audit Log", "GET /api/hq/developer/audit-log"],
                ["App Diagnostics", "GET /api/hq/software-division/:id/diagnostics"],
                ["Compatibility Matrix", "GET /api/hq/developer/compatibility"],
                ["Auth — Verify", "POST /api/hq/auth/verify"],
                ["Auth — Session", "GET /api/hq/auth/session"],
                ["People", "GET /api/hq/people"],
                ["Finance", "GET /api/hq/finance/overview"],
                ["Grants", "GET /api/hq/grants/overview"],
                ["Analytics", "GET /api/hq/analytics/overview"],
                ["AURA Chat", "POST /api/hq/aura/chat"],
                ["AURA Forecast", "POST /api/hq/aura/forecast"],
                ["Notifications", "GET /api/hq/enterprise/notifications"],
                ["WebSocket (event push)", "WS /api/hq/ws"],
                ["Role Templates", "GET /api/hq/workspace/templates"],
                ["User Workspace", "GET/PUT /api/hq/workspace/dashboard"],
              ].map(([label, endpoint]) => (
                <div key={endpoint} className="hq-dev-endpoint-row">
                  <span>{label}</span>
                  <code>{endpoint}</code>
                </div>
              ))}
            </div>
          </HqPanel>
        </div>
      )}

      {tab === "versions" && compatibility.data && (
        <div className="hq-fade-in">
          <HqPanel title="Recommended Versions">
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
              <StatusBadge label={`SDK v${compatibility.data.recommended.sdk}`} variant="gold" />
              <StatusBadge label={`Platform v${compatibility.data.recommended.platform}`} variant="success" />
            </div>
          </HqPanel>
          <HqPanel title="Compatibility Matrix" className="hq-mt-panel">
            <div className="hq-compat-table">
              <div className="hq-compat-header">
                <span>SDK</span><span>Platform</span><span>Status</span><span>Notes</span>
              </div>
              {compatibility.data.matrix.map((row) => (
                <div key={row.sdk} className={`hq-compat-row ${row.status === "current" ? "current" : ""}`}>
                  <span>{row.sdk}</span>
                  <span>{row.platform}</span>
                  <StatusBadge label={row.status} variant={row.status === "current" ? "gold" : row.status === "supported" ? "success" : "muted"} />
                  <span className="hq-muted-text">{row.notes}</span>
                </div>
              ))}
            </div>
          </HqPanel>
          <HqPanel title="Inherited Services (never rebuild)" className="hq-mt-panel">
            <div className="hq-framework-scopes">
              {compatibility.data.inheritedServices.map((s) => (
                <StatusBadge key={s} label={s} variant="muted" />
              ))}
            </div>
          </HqPanel>
        </div>
      )}

      {tab === "security" && (
        <div className="hq-fade-in">
          <SecurityAuditPanel />
          {docs.data && (
          <>
          <HqPanel title="Security Standards" subtitle="Required for all IFCDC applications" className="hq-mt-panel">
            <ul className="hq-dev-list">
              {docs.data.security.requiredHeaders.map((h) => <li key={h}><code>{h}</code></li>)}
            </ul>
            <div className="hq-framework-principles" style={{ marginTop: "1rem" }}>
              <div className="hq-framework-principle"><Shield size={14} /> {docs.data.security.transport}</div>
              <div className="hq-framework-principle"><KeyIcon /> API keys: {docs.data.security.apiKeys.format} — {docs.data.security.apiKeys.storage}</div>
              <div className="hq-framework-principle"><GitBranch size={14} /> {docs.data.security.rbac}</div>
            </div>
          </HqPanel>

          <HqPanel title="Versioning" className="hq-mt-panel">
            <p className="hq-muted-text">{docs.data.versioning.breakingChanges}</p>
            <div className="hq-dev-endpoint-table" style={{ marginTop: "0.75rem" }}>
              {Object.entries(docs.data.versioning.compatibility).map(([ver, note]) => (
                <div key={ver} className="hq-dev-endpoint-row">
                  <span>{ver}</span>
                  <code>{note}</code>
                </div>
              ))}
            </div>
          </HqPanel>

          <HqPanel title="Integration Principles" className="hq-mt-panel">
            <div className="hq-framework-principles">
              {(framework.data?.principles ?? []).map((p) => (
                <div key={p} className="hq-framework-principle"><Radio size={14} /> {p}</div>
              ))}
            </div>
          </HqPanel>
          </>
          )}
        </div>
      )}
    </HQLayout>
  );
};

function KeyIcon() {
  return <Code2 size={14} />;
}

export default DeveloperPortalPage;
