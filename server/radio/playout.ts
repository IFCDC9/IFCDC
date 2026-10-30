import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import { StationStore, selectPlayback } from './station';

function stopChild(child: ChildProcessWithoutNullStreams | undefined) {
  if (child?.pid && child.pid > 0 && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

/** One private station encoder per HQ process, independent of browser listeners. */
export class RadioPlayout {
  private encoder?: ChildProcessWithoutNullStreams;
  private decoder?: ChildProcessWithoutNullStreams;
  private timer?: ReturnType<typeof setInterval>;
  private listeners = new Set<Response>();
  private ticking = false;
  private stopped = true;
  private key = '';
  private retryAt = 0;
  private lastBytesAt = 0;
  private encoderStartedAt = 0;
  private bytes = 0;
  private mode = 'disabled';
  private fault: string | null = null;
  private unavailable = new Map<string,number>();
  private trackTitle: string | null = null;
  private trackId: string | null = null;
  private showTitle: string | null = null;
  constructor(private store: StationStore, private ffmpeg = process.env.RADIO_FFMPEG_PATH || 'ffmpeg') {}
  status() {
    return { enabled: !this.stopped, ready: !this.stopped && !!this.encoder && this.lastBytesAt > 0 && Date.now()-this.lastBytesAt < 5000,
      mode: this.mode, trackTitle:this.trackTitle, trackId:this.trackId, showTitle:this.showTitle, error: this.fault, listeners: this.listeners.size, bytes: this.bytes,
      lastAudioAt: this.lastBytesAt ? new Date(this.lastBytesAt).toISOString() : null };
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false; this.mode = 'starting';
    this.timer = setInterval(() => { void this.tick(); }, 1000);
    void this.tick();
  }
  stop() {
    this.stopped = true; this.mode = 'disabled';
    clearInterval(this.timer); this.timer = undefined;
    this.stopDecoder();
    stopChild(this.encoder); this.encoder = undefined;
    for (const listener of this.listeners) listener.end();
    this.listeners.clear();
  }
  listen(res: Response) {
    if (!this.status().ready) { res.status(503).json({error:'Private stream is not ready. Check station status.'}); return; }
    if (this.listeners.size >= 10) { res.status(503).json({error:'Private listener limit reached.'}); return; }
    res.status(200).set({'Content-Type':'audio/mpeg','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    res.flushHeaders(); this.listeners.add(res);
    res.on('close', () => this.listeners.delete(res));
  }
  private stopDecoder() {
    const decoder = this.decoder; this.decoder = undefined;
    decoder?.stdout.unpipe(); stopChild(decoder); this.key = '';
  }
  private async tick() {
    if (this.stopped || this.ticking || Date.now() < this.retryAt) return;
    this.ticking = true;
    try {
      const state = await this.store.read();
      if (this.stopped) return;
      if (this.encoder && Date.now()-(this.lastBytesAt || this.encoderStartedAt) > 10000) {
        stopChild(this.encoder); this.encoder = undefined; this.stopDecoder();
      }
      if (!this.encoder) this.createEncoder();
      for(const [id,until] of this.unavailable) if(until<=Date.now()) this.unavailable.delete(id);
      let selection = selectPlayback(state,Date.now(),new Set(this.unavailable.keys()));
      // Missing files fall back immediately without changing saved shows.
      while(selection) {
        try {
          if(!/^[a-f0-9-]+\.mp3$/i.test(selection.track.filename)) throw new Error('Invalid stored filename');
          await access(path.resolve(this.store.directory,selection.track.filename));
          break;
        } catch {
          this.unavailable.set(selection.track.id,Date.now()+60000);
          this.fault='A media file is unavailable; using fallback or silence.';
          selection=selectPlayback(state,Date.now(),new Set(this.unavailable.keys()));
        }
      }
      // Include index to support repeated tracks in a single show.
      const key = selection ? `${selection.slot.id}:${selection.index}` : 'silence';
      if (this.decoder && this.key === key) return;
      this.stopDecoder();
      let input: string[];
      if (selection) {
        if (!/^[a-f0-9-]+\.mp3$/i.test(selection.track.filename)) throw new Error('Invalid stored radio filename');
        const file = path.resolve(this.store.directory, selection.track.filename);
        await access(file);
        if (this.stopped) return;
        input = ['-re','-ss',String(selection.offset),'-i',file,'-t',String(Math.max(0.05,selection.track.duration-selection.offset))];
      } else input = ['-re','-f','lavfi','-i','anullsrc=r=44100:cl=stereo'];
      const decoder = spawn(this.ffmpeg,['-hide_banner','-loglevel','error',...input,'-vn','-f','s16le','-ar','44100','-ac','2','pipe:1']);
      this.decoder = decoder; this.key = key; this.mode = selection?.mode || 'silence'; this.trackTitle=selection?.track.title || null; this.trackId=selection?.track.id || null;this.showTitle=selection?.slot.title || null;
      if(!this.unavailable.size)this.fault = null;
      decoder.stdout.pipe(this.encoder!.stdin,{end:false});
      decoder.stderr.resume();
      const failed = () => {
        if (this.decoder !== decoder) return;
        if(selection)this.unavailable.set(selection.track.id,Date.now()+60000);
        this.stopDecoder(); this.fault = 'Audio decoder failed; switching to fallback or silence.'; this.mode = 'error';
      };
      decoder.on('error',failed);
      decoder.on('close',code => { if (this.decoder !== decoder) return; if (code !== 0) failed(); else { this.decoder=undefined; this.key=''; } });
    } catch (error) {
      this.fault = error instanceof Error ? error.message : 'Radio playout failed';
      this.mode = 'error'; this.retryAt = Date.now()+5000; this.stopDecoder();
    } finally { this.ticking = false; }
  }
  private createEncoder() {
    const encoder = spawn(this.ffmpeg,['-hide_banner','-loglevel','error','-f','s16le','-ar','44100','-ac','2','-i','pipe:0','-c:a','libmp3lame','-b:a','128k','-write_xing','0','-id3v2_version','0','-flush_packets','1','-f','mp3','pipe:1']);
    this.encoder=encoder; this.lastBytesAt=0; this.encoderStartedAt=Date.now(); encoder.stderr.resume();
    encoder.stdout.on('data',(chunk: Buffer) => {
      if (this.encoder !== encoder) return;
      this.lastBytesAt=Date.now(); this.bytes+=chunk.length;
      for (const listener of this.listeners) {
        // Disconnect slow clients instead of buffering unbounded audio or blocking the station.
        if (listener.destroyed || listener.writableLength > 128*1024 || !listener.write(chunk)) { listener.destroy(); this.listeners.delete(listener); }
      }
    });
    const failed = () => {
      if (this.encoder !== encoder) return;
      this.encoder=undefined; stopChild(encoder); this.stopDecoder();
      this.fault='Encoder stopped; retrying in five seconds.'; this.mode='error'; this.retryAt=Date.now()+5000;
      for (const listener of this.listeners) listener.end(); this.listeners.clear();
    };
    encoder.stdin.on('error',failed); encoder.on('error',failed); encoder.on('close',failed);
  }
}
