import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Sparkles, FileText } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

export const GrantLibraryPanel: React.FC<{ onApplyTemplate?: (templateId: string) => void }> = ({ onApplyTemplate }) => {
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const library = useQuery({ queryKey: ["grant-library", category], queryFn: () => grantsApi.grantLibrary(category || undefined) });
  const detail = useQuery({
    queryKey: ["grant-template", selected],
    queryFn: () => grantsApi.grantTemplate(String(selected)),
    enabled: !!selected,
  });

  const templates = (library.data?.templates ?? []) as { id: string; slug: string; title: string; category: string; funder_type: string; description: string; usage_count: number }[];

  return (
    <div className="hq-fade-in">
      <HqPanel title="Grant Library" subtitle="Reusable templates for federal, state, foundation, and corporate proposals">
        <StatusBadge label="TEMPLATE LIBRARY" variant="gold" />
        <div className="hq-founder-command-strip" style={{ margin: "1rem 0" }}>
          {["", "federal", "state", "foundation", "corporate", "reporting", "budget"].map((c) => (
            <button key={c || "all"} type="button" className={`hq-btn hq-btn-sm ${category === c ? "hq-btn-primary" : "hq-btn-secondary"}`} onClick={() => setCategory(c)}>
              {c || "All"}
            </button>
          ))}
        </div>
        {library.isLoading ? <HqLoading /> : (
          <div className="hq-grid-2">
            <div>
              <table className="hq-table">
                <thead><tr><th>Template</th><th>Category</th><th>Used</th><th></th></tr></thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td><button type="button" className="hq-entity-link" onClick={() => setSelected(t.id)}>{t.title}</button></td>
                      <td>{t.category}</td>
                      <td>{t.usage_count}</td>
                      <td>{onApplyTemplate && <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => onApplyTemplate(t.id)}>Use</button>}</td>
                    </tr>
                  ))}
                  {templates.length === 0 && <tr><td colSpan={4} className="hq-muted-text">No templates in this category.</td></tr>}
                </tbody>
              </table>
            </div>
            <div>
              {selected && detail.isLoading && <HqLoading />}
              {detail.data?.template && (
                <div className="hq-panel" style={{ padding: "1rem" }}>
                  <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}><BookOpen size={14} style={{ display: "inline" }} /> {(detail.data.template as { title: string }).title}</h4>
                  <p className="hq-muted-text" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>{String((detail.data.template as { description: string }).description)}</p>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", maxHeight: 280, overflow: "auto" }}>{String((detail.data.template as { content: string }).content ?? "")}</pre>
                </div>
              )}
            </div>
          </div>
        )}
        <p className="hq-muted-text" style={{ marginTop: "1rem", fontSize: "0.75rem" }}>
          Integration placeholders: winning proposal archive and Grants.gov template sync planned.
        </p>
      </HqPanel>
    </div>
  );
};

export const GrantWriterStudioPanel: React.FC<{
  applications: { id: string; title: string }[];
  selectedApplicationId: string | null;
  onSelectApplication: (id: string) => void;
}> = ({ applications, selectedApplicationId, onSelectApplication }) => {
  const qc = useQueryClient();
  const [activeSection, setActiveSection] = useState("executive_summary");
  const [draft, setDraft] = useState<Record<string, string>>({});

  const studio = useQuery({
    queryKey: ["grant-writer-studio", selectedApplicationId],
    queryFn: () => grantsApi.writerStudio(String(selectedApplicationId)),
    enabled: !!selectedApplicationId,
  });

  const saveSection = useMutation({
    mutationFn: ({ sectionKey, content }: { sectionKey: string; content: string }) =>
      grantsApi.saveWriterSection(String(selectedApplicationId), sectionKey, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grant-writer-studio", selectedApplicationId] }),
  });

  const aiAssist = useMutation({
    mutationFn: (sectionKey: string) => grantsApi.writerAiAssist(String(selectedApplicationId), sectionKey),
    onSuccess: (data, sectionKey) => {
      const content = String((data as { content?: string; narrative?: string }).content ?? (data as { narrative?: string }).narrative ?? "");
      setDraft((d) => ({ ...d, [sectionKey]: content }));
    },
  });

  const sections = (studio.data?.writerSections?.sections ?? []) as { section_key: string; section_label: string; content: string }[];
  const current = sections.find((s) => s.section_key === activeSection);
  const content = draft[activeSection] ?? current?.content ?? "";

  return (
    <div className="hq-fade-in">
      <HqPanel title="Grant Writer Studio" subtitle="Draft, save, and AI-assist each narrative section">
        <div className="hq-form-grid" style={{ marginBottom: "1rem", maxWidth: 480 }}>
          <select className="hq-input" value={selectedApplicationId ?? ""} onChange={(e) => onSelectApplication(e.target.value)}>
            <option value="">Select application…</option>
            {applications.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </div>
        {!selectedApplicationId ? (
          <p className="hq-muted-text">Choose an application to open the writer workspace.</p>
        ) : studio.isLoading ? <HqLoading /> : (
          <>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <StatusBadge label={`${studio.data?.writerSections?.completionPct ?? 0}% complete`} variant="gold" />
              {sections.map((s) => (
                <button key={s.section_key} type="button" className={`hq-btn hq-btn-sm ${activeSection === s.section_key ? "hq-btn-primary" : "hq-btn-secondary"}`} onClick={() => setActiveSection(s.section_key)}>
                  {s.section_label}
                </button>
              ))}
            </div>
            <textarea
              className="hq-input"
              rows={14}
              style={{ width: "100%", fontFamily: "inherit", lineHeight: 1.6 }}
              value={content}
              onChange={(e) => setDraft({ ...draft, [activeSection]: e.target.value })}
              placeholder={`Write ${current?.section_label ?? activeSection}…`}
            />
            <div className="hq-founder-command-strip" style={{ marginTop: "0.75rem" }}>
              <button type="button" className="hq-btn hq-btn-primary" disabled={saveSection.isPending} onClick={() => saveSection.mutate({ sectionKey: activeSection, content })}>
                <FileText size={14} /> Save Section
              </button>
              <button type="button" className="hq-btn hq-btn-secondary" disabled={aiAssist.isPending} onClick={() => aiAssist.mutate(activeSection)}>
                <Sparkles size={14} /> AURA Draft
              </button>
            </div>
            {studio.data?.application && (
              <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
                Opportunity: {String((studio.data.application as { opportunity_title?: string }).opportunity_title ?? "—")}
              </p>
            )}
          </>
        )}
      </HqPanel>
    </div>
  );
};

export const GrantOpportunityFinderPanel: React.FC = () => {
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const finder = useQuery({
    queryKey: ["grant-opportunity-finder", category, q],
    queryFn: () => grantsApi.opportunityFinder({ category: category || undefined, q: q || undefined }),
  });

  const data = finder.data as { categorized?: Record<string, unknown[]>; opportunities?: unknown[]; integrations?: string } | undefined;
  const list = category && data?.categorized?.[category] ? data.categorized[category] : (data?.opportunities ?? []);

  return (
    <HqPanel title="Grant Opportunity Finder" subtitle="Federal, state, foundation, and corporate opportunities — live feeds connect later">
      <div className="hq-founder-command-strip" style={{ marginBottom: "1rem", flexWrap: "wrap" }}>
        {["federal", "state", "foundation", "corporate"].map((c) => (
          <button key={c} type="button" className={`hq-btn hq-btn-sm ${category === c ? "hq-btn-primary" : "hq-btn-secondary"}`} onClick={() => setCategory(category === c ? "" : c)}>{c}</button>
        ))}
        <input className="hq-input" placeholder="Search opportunities…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200 }} />
      </div>
      {finder.isLoading ? <HqLoading /> : (
        <table className="hq-table">
          <thead><tr><th>Title</th><th>Funder</th><th>Deadline</th><th>Max Award</th></tr></thead>
          <tbody>
            {(list as { id: string; title: string; funder: string; deadline?: string; amount_max?: number }[]).map((o) => (
              <tr key={String(o.id)}><td>{o.title}</td><td>{o.funder}</td><td>{o.deadline ?? "—"}</td><td>{o.amount_max ? `$${o.amount_max.toLocaleString()}` : "—"}</td></tr>
            ))}
            {(list as unknown[]).length === 0 && <tr><td colSpan={4} className="hq-muted-text">No opportunities match. Add grants or connect external feeds.</td></tr>}
          </tbody>
        </table>
      )}
      <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>Grants.gov and SAM.gov integrations: placeholder — local database active.</p>
    </HqPanel>
  );
};
