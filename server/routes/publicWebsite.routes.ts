import express, { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from '../config/dataPaths';
import { hqAuthRequired } from '../middleware/hqAuth';
import { engineeringApprovalAllowed } from '../hq/auraEngineeringWorkflow';
import { mediaItem, saveWebsiteInquiry, websiteDb, websiteOrigins, websiteLimit, WebsiteError } from '../hq/publicWebsite';
export function publicWebsiteRouter() {
  const router = Router();
  const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { Promise.resolve().then(() => fn(req,res)).catch(error => res.status(error instanceof WebsiteError ? error.status : 503).json({ error: error instanceof WebsiteError ? error.message : 'Website service is temporarily unavailable. Contact service@ifcdc.org.' })); };
  router.use((_req,res,next) => { res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); next(); });
  router.get('/content', handle(async (req,res) => {
    await websiteLimit(req.ip || 'unknown', 'read', 180);
    return res.json({ items: await (await websiteDb()).all('SELECT id,kind,section,title,description,url FROM ifcdc_website_content WHERE published = 1 ORDER BY updated_at DESC LIMIT 60') });
  }));
  router.get('/media/:name', handle(async (req,res) => {
    if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(req.params.name)) throw new WebsiteError(404, 'Image not found.');
    // Uploaded bytes can never become executable HTML, SVG, or JavaScript.
    res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    return res.sendFile(path.join(getDataDir(), 'website-media', req.params.name), error => { if (error && !res.headersSent) res.status(404).end(); });
  }));
  router.get('/admin', hqAuthRequired, handle(async (req,res) => {
    founder(req); const db = await websiteDb();
    return res.json({ items: await db.all('SELECT * FROM ifcdc_website_content ORDER BY updated_at DESC LIMIT 100'), messages: await db.all('SELECT id,name,email,topic,message,created_at,notification FROM ifcdc_website_messages ORDER BY created_at DESC LIMIT 100'), notificationsConfigured: !!process.env.POSTMARK_SERVER_TOKEN?.trim() });
  }));
  router.use((req,res,next) => { if (req.method !== 'POST' || !req.is('application/json') || !websiteOrigins().includes(req.get('origin') || '')) { res.status(403).json({ error: 'Submit this request from the IFCDC website or HQ.' }); return; } next(); });
  router.post('/inquiries', express.json({ limit: '16kb' }), handle(async (req,res) => res.status(201).json(await saveWebsiteInquiry(req.body, req.ip || 'unknown'))));
  router.post('/content', hqAuthRequired, express.json({ limit: '16kb' }), handle(async (req,res) => {
    founder(req); const item = mediaItem(req.body); const id = req.body.id || crypto.randomUUID();
    if (!/^[a-f0-9-]{36}$/.test(id) || typeof req.body.published !== 'boolean') throw new WebsiteError(400, 'Invalid publication details.');
    const db = await websiteDb(); const count = await db.get('SELECT COUNT(*) AS count FROM ifcdc_website_content');
    if (count.count >= 100 && !await db.get('SELECT id FROM ifcdc_website_content WHERE id = ?', id)) throw new WebsiteError(409, 'Content limit reached. Edit an existing item.');
    await db.run(`INSERT INTO ifcdc_website_content VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, section=excluded.section, title=excluded.title, description=excluded.description, url=excluded.url, published=excluded.published, updated_at=excluded.updated_at`, id,item.kind,item.section,item.title,item.description,item.url,Number(req.body.published),Date.now());
    return res.json({ id, saved: true });
  }));
  router.post('/upload', hqAuthRequired, express.json({ limit: '7mb' }), handle(async (req,res) => {
    founder(req); await websiteLimit(req.hqUser!.id, 'upload', 30);
    const data = req.body?.data;
    if (typeof data !== 'string' || data.length > 7000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new WebsiteError(400, 'Choose a JPEG, PNG, or WebP image up to 5 MB.');
    const bytes = Buffer.from(data, 'base64'); let ext = '';
    if (bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) ext = 'jpg';
    if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext = 'png';
    if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') ext = 'webp';
    if (!ext || bytes.length < 32 || bytes.length > 5 * 1024 * 1024) throw new WebsiteError(400, 'Choose a JPEG, PNG, or WebP image up to 5 MB.');
    const dir = path.join(getDataDir(), 'website-media'); await fs.mkdir(dir,{recursive:true});
    const files = await fs.readdir(dir);
    if (files.length >= 100) throw new WebsiteError(409, 'Image storage limit reached. Reuse an existing image or contact your administrator.');
    const name = `${crypto.randomUUID()}.${ext}`; await fs.writeFile(path.join(dir,name),bytes,{flag:'wx'});
    return res.status(201).json({ url: `/api/public/website/media/${name}` });
  }));
  router.use((error: any,_req: Request,res: Response,_next: any) => res.status(error.status === 413 ? 413 : 400).json({ error: 'The submitted request could not be read or is too large.' }));
  return router;
}
function founder(req: Request) {
  if (!req.hqUser?.email || !engineeringApprovalAllowed(req.hqUser) || req.hqUser.email.toLowerCase() !== (process.env.MASTER_OWNER_EMAIL || 'service@ifcdc.org').toLowerCase()) throw new WebsiteError(403,'Founder access required.');
}
export default publicWebsiteRouter();
