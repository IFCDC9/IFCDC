/** Client-side report helpers for Executive Chat (no new backend services). */

const SAVED_REPORTS_KEY = "ifcdc.aura.savedReports";

export type SavedAuraReport = {
  id: string;
  title: string;
  body: string;
  jobId?: string;
  savedAt: string;
};

export function copyAuraText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}

export function exportAuraReportMarkdown(title: string, body: string): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const content = `# ${title}\n\nGenerated: ${new Date().toLocaleString()}\n\n${body}\n`;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `IFCDC-AURA-Report-${stamp}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens a print-ready window so the founder can Save as PDF from the system dialog. */
export function exportAuraReportPdf(title: string, body: string): void {
  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!win) {
    exportAuraReportMarkdown(title, body);
    return;
  }
  const safe = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>
      body { font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif; color: #111; padding: 2rem; line-height: 1.55; max-width: 820px; margin: 0 auto; }
      h1 { font-size: 1.4rem; margin-bottom: 0.35rem; }
      .meta { color: #555; font-size: 0.85rem; margin-bottom: 1.5rem; }
      .body { white-space: pre-wrap; font-size: 0.95rem; }
      @media print { body { padding: 0; } }
    </style></head><body>
      <h1>${title}</h1>
      <div class="meta">IFCDC Headquarters · AURA Executive Report · ${new Date().toLocaleString()}</div>
      <div class="body">${safe}</div>
      <script>setTimeout(function(){window.print();},250);</script>
    </body></html>`);
  win.document.close();
}

export function saveAuraReport(input: { title: string; body: string; jobId?: string }): SavedAuraReport {
  const report: SavedAuraReport = {
    id: `report_${Date.now().toString(36)}`,
    title: input.title,
    body: input.body,
    jobId: input.jobId,
    savedAt: new Date().toISOString(),
  };
  try {
    const prev = JSON.parse(localStorage.getItem(SAVED_REPORTS_KEY) || "[]") as SavedAuraReport[];
    const next = [report, ...prev].slice(0, 40);
    localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(next));
  } catch {
    /* storage full / private mode */
  }
  return report;
}

export function listSavedAuraReports(): SavedAuraReport[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_REPORTS_KEY) || "[]") as SavedAuraReport[];
  } catch {
    return [];
  }
}
