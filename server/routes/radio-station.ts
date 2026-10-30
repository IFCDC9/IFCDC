import { buildCrate, catalogSchema, crateRulesSchema } from '../radio/catalog';
import { RadioPlayout } from '../radio/playout';
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { StationStore, nowPlaying } from '../radio/station';
const router = Router();
const store = new StationStore(process.env.RADIO_DATA_DIR || '');
const playout = new RadioPlayout(store);
export function startRadioPlayout() {
  if (process.env.RADIO_PLAYOUT_ENABLED !== 'true') return;
  playout.start();
  // Preserve process termination while cleaning up child encoders.
  process.once('SIGTERM', () => { playout.stop(); process.exit(0); });
  process.once('SIGINT', () => { playout.stop(); process.exit(0); });
}
const readAccess = requireAuth(['radio_host', 'radio', 'admin', 'EXEC', 'founder']);
const manage = requireAuth(['admin', 'founder']);
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req,res).catch(next); };
router.get('/stream', readAccess, (_req,res) => playout.listen(res));
router.get('/station', readAccess, wrap(async (_req,res) => {
  if (!store.directory) return res.json({ configured: false, crates: [], tracks: [], slots: [], log: [], now: null, streaming: false, playout: playout.status() });
  const state = await store.read();
  res.json({ configured: true, ...state, crates: state.crates || [], now: nowPlaying(state), streaming: false, playout: playout.status() });
}));
router.post('/library', manage, express.raw({ type: 'audio/mpeg', limit: '25mb' }), wrap(async (req,res) => {
  const metadata = z.object({ title: z.string().trim().min(1).max(200), duration: z.coerce.number().positive().max(86400) }).parse(req.query);
  const audio = req.body;
  if (!Buffer.isBuffer(audio) || audio.length < 3 || !(audio.subarray(0,3).toString() === 'ID3' || (audio[0] === 255 && (audio[1] & 224) === 224))) return res.status(400).json({ error: 'Upload an MP3 audio file (maximum 25 MB).' });
  const id = randomUUID();
  const track = { ...metadata, id, filename: `${id}.mp3` };
  await store.update(req.user!.id, `Uploaded ${track.title}`, async state => {
    if (state.tracks.length >= 500) throw new Error('Library limit reached (500 tracks).');
    const file = path.join(store.directory, track.filename);
    await writeFile(file, audio, { flag: 'wx', mode: 0o600 });
    state.tracks.push(track);
  });
  res.status(201).json(track);
}));
router.patch('/library/:id/catalog', manage, wrap(async (req,res) => {
  const catalog = catalogSchema.parse(req.body);
  if (!(await store.read()).tracks.some(t=>t.id===req.params.id)) return res.status(404).json({error:'Track not found'});
  const state=await store.update(req.user!.id, `Cataloged track ${req.params.id}`, s=>{
    const track=s.tracks.find(t=>t.id===req.params.id)!;
    track.catalog=catalog; track.catalogUpdatedAt=new Date().toISOString(); track.catalogUpdatedBy=req.user!.id;
  });
  res.json(state.tracks.find(t=>t.id===req.params.id));
}));
router.post('/crates', manage, wrap(async (req,res) => {
  const input=z.object({name:z.string().trim().min(1).max(100),tracks:z.array(z.string().uuid()).max(200).optional(),rules:crateRulesSchema.optional()}).strict()
    .refine(v=>(v.tracks !== undefined) !== (v.rules !== undefined),{message:'Choose selected tracks or builder rules'}).parse(req.body);
  const state=await store.update(req.user!.id, `Created crate ${input.name}`, s=>{
    const tracks=input.rules ? buildCrate(s.tracks,input.rules) : [...new Set(input.tracks!)];
    if (!tracks.length) throw Object.assign(new Error('No tracks match. Catalog tracks or change your selection.'),{status:400});
    if (tracks.length>200) throw Object.assign(new Error('Crates support up to 200 tracks. Narrow the builder rules.'),{status:400});
    if (tracks.some(id=>!s.tracks.some(t=>t.id===id))) throw Object.assign(new Error('Track not found'),{status:400});
    s.crates ||= [];
    if(s.crates.length>=200) throw Object.assign(new Error('Crate limit reached (200). Remove an unused crate.'),{status:400});
    s.crates.push({id:randomUUID(),name:input.name,tracks,createdAt:new Date().toISOString(),...(input.rules ? {rules:input.rules} : {})});
  });
  res.status(201).json(state.crates!.at(-1));
}));
router.delete('/crates/:id', manage, wrap(async (req,res) => {
  await store.update(req.user!.id, `Removed crate ${req.params.id}`, s=>{s.crates=(s.crates || []).filter(c=>c.id!==req.params.id);});
  res.sendStatus(204);
}));
router.get('/library/:id/audio', readAccess, wrap(async (req,res) => {
  const state = await store.read();
  const track = state.tracks.find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  res.type('audio/mpeg').sendFile(path.resolve(store.directory, track.filename));
}));
router.post('/schedule', manage, wrap(async (req,res) => {
  const slot = z.object({ title: z.string().trim().min(1).max(200), start: z.string().datetime(), tracks: z.array(z.string().uuid()).min(1).max(200) }).parse(req.body);
  const state = await store.update(req.user!.id, `Scheduled ${slot.title}`, state => {
    if (slot.tracks.some(id => !state.tracks.some(t => t.id === id))) throw new Error('One or more tracks no longer exist.');
    if (Date.parse(slot.start) < Date.now() - 60000) throw new Error('Choose a current or future start time.');
    if (state.slots.length >= 1000) throw new Error('Schedule limit reached. Remove old shows first.');
    state.slots.push({ ...slot, id: randomUUID() });
  });
  res.status(201).json(state.slots.at(-1));
}));
router.delete('/schedule/:id', manage, wrap(async (req,res) => {
  await store.update(req.user!.id, `Removed scheduled show ${req.params.id}`, state => { state.slots = state.slots.filter(s => s.id !== req.params.id); });
  res.sendStatus(204);
}));
router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map(i => i.message).join('; ') });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'MP3 exceeds 25 MB.' });
  console.error('Radio station:', err);
  res.status(err.status === 400 ? 400 : 503).json({ error: err.message || 'Radio storage unavailable' });
});
export default router;
