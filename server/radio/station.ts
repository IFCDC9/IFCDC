import { recurringSlots, fallbackSelection, type RecurringShow, type Fallback } from './automation';
import type { Catalog, Crate } from './catalog';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
export type Track = { id: string; title: string; duration: number; filename: string; contentHash?:string; bytes?:number; catalog?: Catalog; durationVerifiedAt?: string; catalogUpdatedAt?: string; catalogUpdatedBy?: string };
export type Slot = { id: string; title: string; start: string; tracks: string[] };
export type Station = { recurring?: RecurringShow[]; fallback?: Fallback; crates?: Crate[]; tracks: Track[]; slots: Slot[]; log: { at: string; actor: string; action: string }[] };
export function nowPlaying(state: Station, time = Date.now()) {
  // Newer shows take precedence; a completed override does not revive an older show.
  const slot = [...state.slots, ...recurringSlots(state.recurring || [], time)].filter(s => Date.parse(s.start) <= time).sort((a,b) => Date.parse(b.start)-Date.parse(a.start))[0];
  if (!slot) return null;
  let elapsed = (time - Date.parse(slot.start)) / 1000;
  for (const [index, id] of slot.tracks.entries()) {
    const track = state.tracks.find(t => t.id === id);
    if (!track) continue;
    if (elapsed < track.duration) return { slot, track, index, offset: elapsed };
    elapsed -= track.duration;
  }
  return null;
}
export function selectPlayback(state: Station, time=Date.now(), excluded:ReadonlySet<string>=new Set()) {
  const scheduled=nowPlaying(state,time);
  if(scheduled && !excluded.has(scheduled.track.id))return {...scheduled,mode:'scheduled' as const};
  const fallback=fallbackSelection(state,time,excluded);
  return fallback ? {...fallback,mode:'fallback' as const} : null;
}
export class StationStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  async read(): Promise<Station> {
    if (!this.directory) throw new Error('Configure RADIO_DATA_DIR on a persistent disk before using radio storage.');
    if (this.directory !== this.directory.trim() || /[\r\n\x00]/.test(this.directory) || !path.isAbsolute(this.directory)) {
      throw new Error('RADIO_DATA_DIR must be an absolute path with no leading/trailing spaces or newlines. Uploads are blocked to protect your library.');
    }
    if(process.env.NODE_ENV === 'production') {
      if(process.platform !== 'linux') throw new Error('A verified Linux persistent mount is required for production radio storage. Use development mode for local testing.');
      const root = process.env.RADIO_PERSISTENT_ROOT || process.env.IFCDC_DATA_DIR || '/opt/render/project/src/data';
      if(!path.isAbsolute(root) || root !== root.trim()) throw new Error('Radio persistent storage root is invalid.');
      const mounted = await realpath(root);
      const mounts = await readFile('/proc/self/mountinfo', 'utf8');
      const decode = (value:string) => value.replace(/\\([0-7]{3})/g, (_, octal:string) => String.fromCharCode(parseInt(octal,8)));
      if(!mounts.split('\n').some(line => decode(line.split(' ')[4] || '') === mounted)) throw new Error('Radio storage root is not a verified persistent mount. Uploads are blocked.');
      const relative = path.relative(path.resolve(root), this.directory);
      if(relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('RADIO_DATA_DIR must be inside the persistent storage root.');
      await mkdir(this.directory, { recursive: true });
      const resolved = await realpath(this.directory);
      const actualRelative = path.relative(mounted, resolved);
      if(actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) throw new Error('Radio directory resolves outside the persistent mount. Uploads are blocked.');
    } else await mkdir(this.directory, { recursive: true });
    try { return JSON.parse(await readFile(path.join(this.directory, 'station.json'), 'utf8')); }
    catch (error: any) { if (error.code === 'ENOENT') {
      if ((await readdir(this.directory)).some(name => name.endsWith('.mp3'))) throw new Error('Radio manifest is missing but audio files exist. Restore the manifest before uploading; existing audio was preserved.');
      return { tracks: [], slots: [], log: [] };
    } throw error; }
  }
  update(actor: string, action: string, change: (state: Station) => void | Promise<void>) {
    const job = this.pending.then(async () => {
      const state = await this.read();
      await change(state);
      state.log = [...state.log, { at: new Date().toISOString(), actor, action }].slice(-1000);
      const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, path.join(this.directory, 'station.json'));
      return state;
    });
    this.pending = job.catch(() => {});
    return job;
  }
}
