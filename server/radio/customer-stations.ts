import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getDb } from '../db';
import { ListenerError } from './listeners';
import { StationStore } from './station';
import { inspectMp3 } from './media';

export const customerStationLimits = { stationsPerAccount: 1, tracks: 100, storageBytes: 250 * 1024 * 1024, trackBytes: 25 * 1024 * 1024, logoBytes: 1024 * 1024 };
export const customerBrandSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(280).default('') }).strict();
const uuid = z.string().uuid();
const problem = (status: number, message: string) => new ListenerError(status, message);
let schema: Promise<any> | undefined;
export async function customerStationDb() {
  if (!schema) schema = (async () => {
    const db = await getDb();
    await db.exec(`CREATE TABLE IF NOT EXISTS radio_customer_stations (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      description TEXT NOT NULL, logo_type TEXT, created_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS radio_customer_station_owner ON radio_customer_stations(owner_id);
      CREATE TRIGGER IF NOT EXISTS radio_customer_station_prevent_owner_delete BEFORE DELETE ON radio_listeners
      WHEN EXISTS(SELECT 1 FROM radio_customer_stations WHERE owner_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Delete the station workspace before deleting its owner.'); END;`);
    return db;
  })().catch(error => { schema = undefined; throw error; });
  return schema;
}

/** One shared operation queue bounds disk/encoder work for the small workspace pilot. */
export class CustomerStations {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }
  private directory(id: string) {
    if (!this.root) throw problem(503, 'Customer station storage is not configured.');
    return path.join(this.root, uuid.parse(id));
  }
  private async owned(owner: string, id: string) {
    const row = await (await customerStationDb()).get('SELECT * FROM radio_customer_stations WHERE id=? AND owner_id=?', uuid.parse(id), owner);
    if (!row) throw problem(404, 'Station workspace not found.');
    return row;
  }
  private publicRecord(row: any) {
    return { id: row.id, name: row.name, description: row.description, hasLogo: !!row.logo_type, createdAt: row.created_at,
      phase: 'draft', subscription: 'not_available', broadcasting: false };
  }
  async list(owner: string) {
    return (await (await customerStationDb()).all('SELECT * FROM radio_customer_stations WHERE owner_id=?', owner)).map((row: any) => this.publicRecord(row));
  }
  create(owner: string, input: z.infer<typeof customerBrandSchema>) {
    return this.run(async () => {
      if (!this.root) throw problem(503, 'Customer station storage is not configured.');
      const id = randomUUID();
      const db = await customerStationDb();
      // SQL enforces uniqueness and the deployment-wide pilot bound in one statement.
      const result = await db.run(`INSERT OR IGNORE INTO radio_customer_stations (id,owner_id,name,description,created_at)
        SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM radio_customer_stations)<100 AND EXISTS(SELECT 1 FROM radio_listeners WHERE id=?)`, id, owner, input.name, input.description, Date.now(), owner);
      if (!result.changes) throw problem(409, 'One station workspace per account; new workspaces may also be at pilot capacity.');
      return this.publicRecord(await this.owned(owner, id));
    });
  }
  async state(owner: string, id: string) {
    const row = await this.owned(owner, id);
    const state = await new StationStore(this.directory(id)).read();
    return { station: this.publicRecord(row), limits: customerStationLimits,
      usedBytes: state.tracks.reduce((n, t) => n + (t.bytes || 0), 0),
      tracks: state.tracks.map(t => ({ id: t.id, title: t.title, duration: t.duration, bytes: t.bytes || 0 })),
      crates: state.crates || [], slots: state.slots };
  }
  update(owner: string, id: string, input: z.infer<typeof customerBrandSchema>) {
    return this.run(async () => { await this.owned(owner, id); await (await customerStationDb()).run('UPDATE radio_customer_stations SET name=?,description=? WHERE id=? AND owner_id=?', input.name, input.description, id, owner); });
  }
  upload(owner: string, id: string, title: string, audio: Buffer) {
    return this.run(async () => {
      await this.owned(owner, id);
      if (!Buffer.isBuffer(audio) || audio.length === 0 || audio.length > customerStationLimits.trackBytes) throw problem(400, 'Choose an MP3 up to 25 MB.');
      const store = new StationStore(this.directory(id));
      const hash = createHash('sha256').update(audio).digest('hex');
      let result: { id: string; duplicate: boolean } | undefined;
      await store.update(owner, 'Customer music upload', async state => {
        const existing = state.tracks.find(t => t.contentHash === hash);
        if (existing) { result = { id: existing.id, duplicate: true }; return; }
        if (state.tracks.length >= customerStationLimits.tracks) throw problem(409, 'Workspace pilot limit: 100 tracks.');
        const used = state.tracks.reduce((n, t) => n + (t.bytes || 0), 0);
        if (used + audio.length > customerStationLimits.storageBytes) throw problem(409, 'Workspace pilot storage limit: 250 MB.');
        const disk = await statfs(store.directory);
        if (disk.bavail * disk.bsize < audio.length + 100 * 1024 * 1024) throw problem(503, 'Station storage is nearly full. Contact IFCDC before adding more music.');
        const duration = await inspectMp3(audio);
        const trackId = randomUUID();
        const filename = `${trackId}.mp3`;
        await writeFile(path.join(store.directory, filename), audio, { flag: 'wx', mode: 0o600 });
        state.tracks.push({ id: trackId, title, duration, filename, bytes: audio.length, contentHash: hash, durationVerifiedAt: new Date().toISOString() });
        result = { id: trackId, duplicate: false };
      });
      return result!;
    });
  }
  async media(owner: string, id: string, trackId: string) {
    await this.owned(owner, id);
    const store = new StationStore(this.directory(id));
    const track = (await store.read()).tracks.find(t => t.id === uuid.parse(trackId));
    if (!track) throw problem(404, 'Track not found.');
    return path.resolve(store.directory, `${track.id}.mp3`);
  }
  removeTrack(owner: string, id: string, trackId: string) {
    return this.run(async () => {
      await this.owned(owner, id); uuid.parse(trackId);
      const store = new StationStore(this.directory(id));
      await store.update(owner, 'Removed customer track', state => {
        if (!state.tracks.some(t => t.id === trackId)) throw problem(404, 'Track not found.');
        state.tracks = state.tracks.filter(t => t.id !== trackId);
        state.crates = (state.crates || []).map(c => ({ ...c, tracks: c.tracks.filter(t => t !== trackId) }));
        state.slots = state.slots.map(s => ({ ...s, tracks: s.tracks.filter(t => t !== trackId) })).filter(s => s.tracks.length);
      });
      await unlink(path.join(store.directory, `${trackId}.mp3`));
    });
  }
  saveCrate(owner: string, id: string, name: string, ids: string[]) {
    return this.run(async () => {
      await this.owned(owner, id);
      const crate = { id: randomUUID(), name, tracks: [...new Set(ids)], createdAt: new Date().toISOString() };
      await new StationStore(this.directory(id)).update(owner, 'Saved customer crate', state => {
        if (crate.tracks.some(t => !state.tracks.some(track => track.id === t))) throw problem(400, 'Choose tracks from your own station library.');
        state.crates ||= []; if (state.crates.length >= 50) throw problem(409, 'Workspace limit: 50 crates.');
        state.crates.push(crate);
      });
      return crate;
    });
  }
  schedule(owner: string, id: string, input: { title: string; start: string; tracks: string[] }) {
    return this.run(async () => {
      await this.owned(owner, id);
      const slot = { ...input, id: randomUUID() };
      await new StationStore(this.directory(id)).update(owner, 'Saved customer draft show', state => {
        if (slot.tracks.some(t => !state.tracks.some(track => track.id === t))) throw problem(400, 'Choose tracks from your own station library.');
        if (Date.parse(slot.start) < Date.now()) throw problem(400, 'Choose a future start time.');
        if (state.slots.length >= 100) throw problem(409, 'Workspace limit: 100 draft shows.');
        state.slots.push(slot);
      });
      return slot;
    });
  }
  removeItem(owner: string, id: string, kind: 'crates' | 'slots', itemId: string) {
    return this.run(async () => { await this.owned(owner, id); uuid.parse(itemId); await new StationStore(this.directory(id)).update(owner, 'Removed customer draft item', state => { if(kind === 'crates') state.crates = (state.crates || []).filter(item => item.id !== itemId); else state.slots = state.slots.filter(item => item.id !== itemId); }); });
  }
  logo(owner: string, id: string, bytes: Buffer) {
    return this.run(async () => {
      await this.owned(owner, id);
      if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > customerStationLimits.logoBytes) throw problem(400, 'Choose a PNG, JPEG, or WebP logo up to 1 MB.');
      const type = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
      if (!type) throw problem(400, 'Use a PNG, JPEG, or WebP image. SVG and HTML are not accepted.');
      const directory = this.directory(id); await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'logo'), bytes, { mode: 0o600 });
      await (await customerStationDb()).run('UPDATE radio_customer_stations SET logo_type=? WHERE id=? AND owner_id=?', type, id, owner);
    });
  }
  async readLogo(owner: string, id: string) {
    const row = await this.owned(owner, id); if (!row.logo_type) throw problem(404, 'No logo uploaded.');
    return { type: row.logo_type, bytes: await readFile(path.join(this.directory(id), 'logo')) };
  }
  remove(owner: string, id: string) {
    return this.run(async () => {
      await this.owned(owner, id);
      await rm(this.directory(id), { recursive: true, force: true });
      await (await customerStationDb()).run('DELETE FROM radio_customer_stations WHERE id=? AND owner_id=?', id, owner);
    });
  }
}
