/**
 * IFCDC Headquarters email brand — black / gold / white.
 * Shared shell for all transactional and AURA-generated emails.
 */

export const HQ_EMAIL_BRAND = {
  black: "#0a0a0a",
  charcoal: "#141414",
  gold: "#c9a227",
  goldBright: "#d4af37",
  white: "#f7f4ec",
  muted: "#b8b0a0",
  border: "#2a2a2a",
  success: "#3d8b6e",
  danger: "#b54a4a",
  fontDisplay: "Georgia, 'Times New Roman', serif",
  fontBody: "Georgia, 'Times New Roman', serif",
  orgName: "Imperial Foundation CDC",
  productName: "IFCDC Headquarters",
  supportEmail: "service@ifcdc.org",
  publicUrl: () =>
    (process.env.PUBLIC_APP_URL || process.env.IFCDC_PUBLIC_URL || "https://ifcdc.org").replace(/\/$/, ""),
} as const;

export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function plainToHtmlParagraphs(text: string): string {
  const escaped = escapeHtml(text.trim());
  if (!escaped) return "";
  return escaped
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.replace(/\n/g, "<br>");
      return `<p style="margin:0 0 1rem;line-height:1.65;color:${HQ_EMAIL_BRAND.white};font-size:15px;">${lines}</p>`;
    })
    .join("");
}

export type BrandedEmailShellInput = {
  preheader?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  bodyHtml: string;
  cta?: { label: string; href: string };
  footerNote?: string;
  moduleLabel?: string;
};

/** Full branded HTML document (black / gold / white). */
export function renderBrandedEmailShell(input: BrandedEmailShellInput): string {
  const b = HQ_EMAIL_BRAND;
  const preheader = escapeHtml(input.preheader || input.subtitle || input.title);
  const eyebrow = escapeHtml(input.eyebrow || input.moduleLabel || "IFCDC HEADQUARTERS");
  const title = escapeHtml(input.title);
  const subtitle = input.subtitle
    ? `<p style="margin:0.5rem 0 0;color:${b.muted};font-size:14px;line-height:1.5;">${escapeHtml(input.subtitle)}</p>`
    : "";
  const cta = input.cta
    ? `<p style="margin:1.75rem 0 0;">
        <a href="${escapeHtml(input.cta.href)}" style="display:inline-block;background:${b.gold};color:${b.black};text-decoration:none;font-weight:700;letter-spacing:0.04em;padding:0.85rem 1.4rem;border-radius:2px;font-size:13px;">
          ${escapeHtml(input.cta.label)}
        </a>
      </p>`
    : "";
  const footerNote = escapeHtml(
    input.footerNote
      || "This message was sent by IFCDC Headquarters. Reply to this email or contact service@ifcdc.org.",
  );
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${b.black};color:${b.white};font-family:${b.fontBody};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${b.black};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:${b.charcoal};border:1px solid ${b.border};">
          <tr>
            <td style="padding:28px 28px 18px;border-bottom:2px solid ${b.gold};">
              <p style="margin:0;font-size:11px;letter-spacing:0.18em;color:${b.gold};text-transform:uppercase;">${eyebrow}</p>
              <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;color:${b.white};font-weight:400;font-family:${b.fontDisplay};">${title}</h1>
              ${subtitle}
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${input.bodyHtml}
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 28px;border-top:1px solid ${b.border};">
              <p style="margin:0;font-size:12px;line-height:1.55;color:${b.muted};">${footerNote}</p>
              <p style="margin:12px 0 0;font-size:11px;letter-spacing:0.12em;color:${b.gold};text-transform:uppercase;">
                ${escapeHtml(b.orgName)} · ${escapeHtml(b.productName)} · ${year}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
