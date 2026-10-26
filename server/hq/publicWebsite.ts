import crypto from 'node:crypto';
import { getDb } from '../db';

export const WEBSITE_ORIGIN = 'https://ifcdc.org';
export const WEBSITE_CONTACT = 'service@ifcdc.org';
export const websiteTopics = ['General enquiry', 'Community programs', 'Partnership or volunteering', 'Careers / expression of interest', 'Software development', 'Music mixing and mastering', 'Video editing', 'Publishing / book enquiry'];
export const websiteSections = ['community', 'software', 'music', 'film', 'publishing', 'radio'];
export function publicWebsiteHost(host: string) { return ['ifcdc.org', 'www.ifcdc.org'].includes(host.toLowerCase().split(':')[0]); }
export function websiteOrigins(env: NodeJS.ProcessEnv = process.env) {
  const origins = [WEBSITE_ORIGIN, 'https://www.ifcdc.org', 'https://ifcdc-hq-wst6.onrender.com', 'https://hq.ifcdc.org'];
  try { const url = new URL(env.AURA_CHECKOUT_LIVE_ORIGIN || ''); if (url.protocol === 'https:' && url.origin === env.AURA_CHECKOUT_LIVE_ORIGIN) origins.push(url.origin); } catch {}
  return origins;
}
export class WebsiteError extends Error { constructor(public status: number, message: string) { super(message); } }
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export function websiteUrl(input: unknown, kind: string) {
  if (typeof input !== 'string' || input.length > 2000) throw new WebsiteError(400, 'Enter a valid HTTPS link.');
  if (kind === 'photo' && /^\/api\/public\/website\/media\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(input)) return input;
  let url: URL; try { url = new URL(input); } catch { throw new WebsiteError(400, 'Enter a valid HTTPS link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) || /\.(local|localhost|internal)$/i.test(url.hostname) || url.port) throw new WebsiteError(400, 'Use a public HTTPS link without login details.');
  if (kind === 'video') {
    let id = ''; let provider = '';
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) { id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)\/?$/)?.[1] || ''; provider = 'youtube'; }
    if (url.hostname === 'youtu.be') { id = url.pathname.slice(1); provider = 'youtube'; }
    if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname)) { id = url.pathname.match(/^\/(?:video\/)?(\d+)\/?$/)?.[1] || ''; provider = 'vimeo'; }
    if (provider === 'youtube' && /^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (url.hostname === 'www.youtube-nocookie.com' && /^\/embed\/[\w-]{11}$/.test(url.pathname)) return url.origin + url.pathname;
    if (provider === 'vimeo' && /^\d{1,15}$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    throw new WebsiteError(400, 'Use a YouTube or Vimeo video link.');
  }
  return url.href;
}
export function mediaItem(value: any) {
  if (!value || !['link', 'photo', 'video'].includes(value.kind) || !websiteSections.includes(value.section)) throw new WebsiteError(400, 'Choose a content type and division.');
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (title.length < 3 || title.length > 120 || description.length > 800) throw new WebsiteError(400, 'Use a title of 3–120 characters and a description up to 800 characters.');
  return { kind: value.kind, section: value.section, title, description, url: websiteUrl(value.url, value.kind) };
}
export async function websiteDb() {
  const db = await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS ifcdc_website_messages (id TEXT PRIMARY KEY, digest TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, topic TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL, notification TEXT NOT NULL DEFAULT 'not_sent');
    CREATE TABLE IF NOT EXISTS ifcdc_website_content (id TEXT PRIMARY KEY, kind TEXT NOT NULL, section TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ifcdc_website_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
  return db;
}
export async function websiteLimit(ip: string, action: string, limit: number) {
  const db = await websiteDb(); const now = Date.now(); const hour = Math.floor(now / 3600000);
  await db.run('DELETE FROM ifcdc_website_limits WHERE expires_at < ?', now);
  for (const [key, max] of [[hash(`${ip}:${action}:${hour}`), limit], [`all:${action}:${hour}`, action === 'read' ? 20000 : 300]] as const) {
    const result = await db.run(`INSERT INTO ifcdc_website_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ?`, key, now + 3600000, max);
    if (!result.changes) throw new WebsiteError(429, 'Too many requests. Please try again later or email service@ifcdc.org.');
  }
}
export function inquiryInput(value: any) {
  if (!value || !/^[a-f0-9-]{36}$/.test(value.id) || value.consent !== true || value.website || !websiteTopics.includes(value.topic)) throw new WebsiteError(400, 'Complete the form and approve IFCDC contacting you.');
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const email = typeof value.email === 'string' ? value.email.trim() : '';
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (name.length < 2 || name.length > 100 || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || message.length < 10 || message.length > 3000) throw new WebsiteError(400, 'Check your name, email, and message (10–3,000 characters).');
  return { id: value.id, name, email, message, topic: value.topic };
}
export async function saveWebsiteInquiry(value: any, ip: string, options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}) {
  const input = inquiryInput(value); const db = await websiteDb(); const digest = hash(JSON.stringify(input));
  let row = await db.get('SELECT digest FROM ifcdc_website_messages WHERE id = ?', input.id);
  if (row && row.digest !== digest) throw new WebsiteError(409, 'This request ID already belongs to another message. Start a new request.');
  if (!row) {
    await websiteLimit(ip, 'message', 5);
    const inserted = await db.run('INSERT OR IGNORE INTO ifcdc_website_messages (id,digest,name,email,topic,message,created_at) VALUES (?,?,?,?,?,?,?)', input.id, digest, input.name, input.email, input.topic, input.message, Date.now());
    row = await db.get('SELECT digest FROM ifcdc_website_messages WHERE id = ?', input.id);
    if (row?.digest !== digest) throw new WebsiteError(409, 'Request ID already in use.');
    // Notification contains only the reference. All submitted details stay in private HQ.
    const env = options.env || process.env; const token = (env.POSTMARK_SERVER_TOKEN || '').trim();
    if (inserted.changes && token) {
      await db.run("UPDATE ifcdc_website_messages SET notification = 'sending' WHERE id = ?", input.id);
      try {
        const response = await (options.fetchImpl || fetch)('https://api.postmarkapp.com/email', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'X-Postmark-Server-Token': token }, body: JSON.stringify({ From: 'IFCDC Website <service@ifcdc.org>', To: WEBSITE_CONTACT, Subject: 'New IFCDC website enquiry', TextBody: `A website enquiry is saved in private HQ.\nReference: ${input.id}\nOpen HQ → Software Engineering → Public website manager to review it.`, MessageStream: 'outbound' }) });
        const result = await response.json() as any;
        await db.run('UPDATE ifcdc_website_messages SET notification = ? WHERE id = ?', response.ok && result.ErrorCode === 0 ? 'accepted' : 'failed', input.id);
      } catch { await db.run("UPDATE ifcdc_website_messages SET notification = 'uncertain' WHERE id = ?", input.id); }
    }
  }
  return { id: input.id, message: 'Your request is saved for IFCDC to review. This is not a booking, job offer, or confirmation of program availability.' };
}
