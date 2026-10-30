import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
export type Track = { id: string; title: string; duration: number; filename: string };
export type Slot = { id: string; title: string; start: string; tracks: string[] };
export type Station = { tracks: Track[]; slots: Slot[]; log: { at: string; actor: string; action: string }[] };
export function nowPlaying(state: Station, time = Date.now()) {
  // Newer shows take precedence; a completed override does not revive an older show.
  const slot = [...state.slots].filter(s => Date.parse(s.start) <= time).sort((a,b) => Date.parse(b.start)-Date.parse(a.start))[0];
  if (!slot) return null;
  let elapsed = (time - Date.parse(slot.start)) / 1000;
  for (const id of slot.tracks) {
    const track = state.tracks.find(t => t.id === id);
    if (!track) continue;
    if (elapsed < track.duration) return { slot, track, offset: elapsed };
    elapsed -= track.duration;
  }
  return null;
}
export class StationStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  async read(): Promise<Station> {
    if (!this.directory) throw new Error('Configure RADIO_DATA_DIR on a persistent disk before using radio storage.');
    await mkdir(this.directory, { recursive: true });
    try { return JSON.parse(await readFile(path.join(this.directory, 'station.json'), 'utf8')); }
    catch (error: any) { if (error.code === 'ENOENT') return { tracks: [], slots: [], log: [] }; throw error; }
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
