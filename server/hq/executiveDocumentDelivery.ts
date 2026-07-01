import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getOrGenerateDailyBriefing } from "./executiveBriefings";
import { generateExecutiveBoardReport } from "./executiveIntelligenceEngine";
import { sendHqNotification } from "../lib/notifications";

function reportsDir(): string {
  const dir = path.join(import.meta.dirname, "..", "..", "data", "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function docId() {
  return crypto.randomUUID();
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Minimal valid single-page PDF for executive documents */
export function buildSimpleTextPdf(title: string, lines: string[]): Buffer {
  const body = [
    `BT /F1 16 Tf 50 780 Td (${escapePdfText(title)}) Tj ET`,
    ...lines.slice(0, 45).map((line, i) =>
      `BT /F1 10 Tf 50 ${750 - i * 14} Td (${escapePdfText(line)}) Tj ET`
    ),
  ].join("\n");

  const stream = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj ${stream} endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000${(400 + body.length).toString().padStart(3, "0")} 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
${450 + body.length}
%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function buildHtmlDocument(title: string, sections: { heading: string; body: string }[]): string {
  const sectionHtml = sections.map((s) => `
    <section style="margin-bottom:1.5rem;">
      <h2 style="color:#c9a227;font-size:1.1rem;margin:0 0 0.5rem;">${s.heading}</h2>
      <div style="white-space:pre-wrap;line-height:1.6;font-size:0.9rem;">${s.body}</div>
    </section>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>@media print{body{margin:0}.no-print{display:none}}</style></head>
    <body style="font-family:Georgia,serif;max-width:800px;margin:2rem auto;padding:2rem;background:#0a0a0a;color:#f0f0f0;">
    <header style="border-bottom:2px solid #c9a227;padding-bottom:1rem;margin-bottom:2rem;">
      <p style="margin:0;font-size:0.75rem;letter-spacing:0.12em;color:#c9a227;">IFCDC HEADQUARTERS</p>
      <h1 style="margin:0.25rem 0 0;font-size:1.5rem;">${title}</h1>
      <p style="margin:0.35rem 0 0;font-size:0.8rem;color:#888;">Generated ${new Date().toLocaleString()}</p>
    </header>
    ${sectionHtml}
    <footer class="no-print" style="margin-top:2rem;font-size:0.75rem;color:#666;">Imperial Foundation Community Development Corporation</footer>
    </body></html>`;
}

export async function generateExecutiveBriefingDocument() {
  const briefing = await getOrGenerateDailyBriefing(false);
  const title = `IFCDC Executive Briefing — ${new Date().toLocaleDateString()}`;
  const sections = [
    { heading: "Highlights", body: (briefing.highlights ?? []).join("\n") },
    { heading: "Full Briefing", body: briefing.content ?? "" },
  ];
  const html = buildHtmlDocument(title, sections);
  const pdfLines = [title, "", ...(briefing.highlights ?? []), "", (briefing.content ?? "").slice(0, 2000)];
  const pdf = buildSimpleTextPdf(title, pdfLines);

  const id = docId();
  const base = `briefing-${new Date().toISOString().slice(0, 10)}-${id.slice(0, 8)}`;
  const htmlPath = path.join(reportsDir(), `${base}.html`);
  const pdfPath = path.join(reportsDir(), `${base}.pdf`);
  fs.writeFileSync(htmlPath, html, "utf8");
  fs.writeFileSync(pdfPath, pdf);

  return { id, type: "briefing" as const, title, htmlPath, pdfPath, generatedAt: new Date().toISOString() };
}

export async function generateBoardReportDocument() {
  const report = await generateExecutiveBoardReport();
  const title = report.title;
  const sections = [
    { heading: "Executive Summary", body: report.executiveSummary },
    { heading: "Organization Scorecard", body: `Overall: ${report.scorecard.overall}% (${report.scorecard.grade})` },
    { heading: "Financial Position", body: `Cash flow: $${report.financial.cashFlow?.toLocaleString()}\nNet position: $${report.financial.netPosition?.toLocaleString()}` },
    { heading: "Grant Portfolio", body: `${report.grants.activeAwards} active awards\nPipeline: $${report.grants.pipelineValue?.toLocaleString()}` },
  ];
  const html = buildHtmlDocument(title, sections);
  const pdfLines = [title, "", report.executiveSummary.slice(0, 2500)];
  const pdf = buildSimpleTextPdf(title, pdfLines);

  const id = docId();
  const base = `board-report-${new Date().toISOString().slice(0, 10)}-${id.slice(0, 8)}`;
  const htmlPath = path.join(reportsDir(), `${base}.html`);
  const pdfPath = path.join(reportsDir(), `${base}.pdf`);
  fs.writeFileSync(htmlPath, html, "utf8");
  fs.writeFileSync(pdfPath, pdf);

  return { id, type: "board_report" as const, title, htmlPath, pdfPath, generatedAt: new Date().toISOString() };
}

export async function deliverExecutiveDocument(
  type: "briefing" | "board_report",
  opts?: { to?: string; sendEmail?: boolean }
) {
  const doc = type === "briefing"
    ? await generateExecutiveBriefingDocument()
    : await generateBoardReportDocument();

  const to = opts?.to ?? process.env.GRANTS_OPERATOR_EMAIL ?? process.env.FOUNDER_EMAIL ?? "service@ifcdc.org";
  let emailStatus: "sent" | "skipped" | "failed" = "skipped";

  if (opts?.sendEmail !== false) {
    try {
      const excerpt = fs.readFileSync(doc.htmlPath, "utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500);
      await sendHqNotification({
        to,
        subject: doc.title,
        body: `Your ${type === "briefing" ? "executive briefing" : "board report"} is ready.\n\n${excerpt}\n\nDownload PDF: /api/hq/intelligence/reports/${path.basename(doc.pdfPath)}?format=pdf`,
        channel: "email",
      });
      emailStatus = "sent";
    } catch {
      emailStatus = "failed";
    }
  }

  return { ...doc, emailStatus, deliveredTo: to };
}

export function readReportFile(filename: string, format: "html" | "pdf"): { buffer: Buffer; contentType: string } | null {
  const safe = path.basename(filename);
  const filePath = path.join(reportsDir(), safe);
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return {
    buffer,
    contentType: format === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
  };
}

export function listRecentReports(limit = 20) {
  const dir = reportsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".html") || f.endsWith(".pdf"))
    .map((f) => ({ filename: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime.toISOString() }))
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, limit);
}
