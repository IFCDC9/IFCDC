import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
type Track = { id: string; title: string; duration: number };
type Slot = { id: string; title: string; start: string; tracks: string[] };
type State = { configured: boolean; tracks: Track[]; slots: Slot[]; log: { at: string; action: string }[]; now: { track: Track; offset: number; slot: Slot } | null };
export default function RadioStation() {
  const { user } = useAuth();
  const canManage = ['admin', 'owner', 'founder'].includes(user?.role || '');
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const audio = useRef<HTMLAudioElement>(null);
  const current = useRef('');
  async function refresh() {
    const response = await fetch('/api/radio/station', { credentials: 'include' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load station');
    setState(data);
  }
  useEffect(() => {
    let mounted = true;
    const poll = () => refresh().catch(e => { if (mounted) setError(e.message); });
    poll(); const timer = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    if (!listening || !state?.now) { player.pause(); current.current = ''; return; }
    const now = state.now;
    const key = `${now.slot.id}:${now.track.id}`;
    if (current.current === key) return;
    current.current = key;
    player.src = `/api/radio/library/${now.track.id}/audio`;
    player.onloadedmetadata = () => {
      player.currentTime = Math.min(now.offset, Number.isFinite(player.duration) ? player.duration : now.offset);
      player.play().catch(() => { setListening(false); setError('Press Listen again to allow audio playback.'); });
    };
    player.load();
  }, [state, listening]);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); await refresh(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function request(url: string, options: RequestInit) {
    const res = await fetch(url, { ...options, credentials: 'include' });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Request failed'); }
  }
  async function upload(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const probe = new Audio(); probe.preload = 'metadata';
        const timer = setTimeout(() => { probe.src = ''; reject(new Error('Could not read audio duration')); }, 15000);
        probe.onloadedmetadata = () => { clearTimeout(timer); resolve(probe.duration); probe.src = ''; };
        probe.onerror = () => { clearTimeout(timer); reject(new Error('Unable to read MP3')); };
        probe.src = url;
      });
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid audio duration');
      await request(`/api/radio/library?${new URLSearchParams({title: file.name.replace(/\.mp3$/i,''), duration: String(duration)})}`, { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: file });
    } finally { URL.revokeObjectURL(url); }
  }
  return <section className="mx-auto max-w-5xl p-6 space-y-6 text-foreground">
    <a href="/hq" className="underline">Back to HQ</a><header><p className="text-amber-400">IFCDC RADIO • STATION OPERATIONS</p><h1 className="text-3xl font-bold">Your community. Your station.</h1>
    <p>Private programming and listening test • public broadcasting is not connected</p></header>
    {error && <p role="alert" className="border border-red-500 rounded p-3">{error}</p>}
    {!state ? <p>Loading station…</p> : <>
      {!state.configured && <p className="border border-amber-500 rounded p-4">Station storage needs setup. Configure RADIO_DATA_DIR on a persistent disk before uploading or scheduling.</p>}
      <section className="border rounded-xl p-5 space-y-3"><h2 className="text-xl font-semibold">Scheduled now</h2>
        <p>{state.now ? `${state.now.slot.title} — ${state.now.track.title}` : 'No scheduled audio playing'}</p>
        <button className="border rounded px-4 py-2" disabled={!state.now} onClick={() => setListening(!listening)}>{listening ? 'Stop listening' : 'Listen to scheduled audio'}</button>
        <audio ref={audio} onEnded={() => { current.current = ''; refresh().catch(e => setError(e.message)); }} onError={() => { setListening(false); current.current = ''; setError('Audio could not be loaded. Check the media file and connection.'); }} />
        <p className="text-sm">Listening follows the show clock. This browser preview is not a continuous broadcast stream.</p>
      </section>
      <section className="border rounded-xl p-5 space-y-3"><h2 className="text-xl font-semibold">Audio library ({state.tracks.length})</h2>
        {canManage && <label className="block">Upload MP3 (maximum 25 MB)<input className="block mt-2" type="file" accept="audio/mpeg,.mp3" disabled={busy || !state.configured} onChange={e => { const file = e.target.files?.[0]; e.target.value=''; if (file) { if (file.size > 25*1024*1024) setError('MP3 exceeds 25 MB'); else action(() => upload(file)); } }} /></label>}
        {state.tracks.length === 0 && <p>Upload your first recording or station ID to begin.</p>}
        {state.tracks.map(t => <label key={t.id} className="flex gap-3 items-center p-2 border-b"><input aria-label={`Select ${t.title}`} type="checkbox" disabled={!canManage} checked={selected.includes(t.id)} onChange={e => setSelected(e.target.checked ? [...selected,t.id] : selected.filter(id => id !== t.id))}/><span>{t.title} · {Math.round(t.duration)} sec</span></label>)}
        {selected.length > 0 && <p>Playback order: {selected.map(id => state.tracks.find(t => t.id === id)?.title).join(' → ')} <button onClick={() => setSelected([])}>Clear</button></p>}
      </section>
      <section className="border rounded-xl p-5 space-y-3"><h2 className="text-xl font-semibold">Show schedule</h2>
        {canManage && <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); const form=e.currentTarget; const data=new FormData(form); action(async () => { await request('/api/radio/schedule', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:data.get('title'),start:new Date(String(data.get('start'))).toISOString(),tracks:selected})}); form.reset(); setSelected([]); }); }}>
          <input className="bg-background border rounded p-2" name="title" placeholder="Show title" aria-label="Show title" maxLength={200} required />
          <label>Start (your local time)<input className="block bg-background border rounded p-2" name="start" type="datetime-local" required /></label>
          <button className="border rounded p-2" disabled={busy || !state.configured || !selected.length}>Schedule selected tracks</button>
        </form>}
        <p className="text-sm">Select tracks in playback order above. Newer scheduled shows interrupt older shows. Times are saved in UTC.</p>
        {state.slots.length === 0 && <p>No shows scheduled yet.</p>}
        {[...state.slots].sort((a,b) => Date.parse(a.start)-Date.parse(b.start)).map(s => <div className="flex flex-wrap justify-between gap-3 border-b p-2" key={s.id}><span>{s.title} · {new Date(s.start).toLocaleString()} · {s.tracks.length} tracks</span>{canManage && <button disabled={busy} onClick={() => action(() => request(`/api/radio/schedule/${s.id}`,{method:'DELETE'}))}>Remove show</button>}</div>)}
      </section>
      <section className="border rounded-xl p-5"><h2 className="text-xl font-semibold">Station activity</h2>{state.log.slice(-10).reverse().map((entry,i) => <p key={i}>{new Date(entry.at).toLocaleString()} — {entry.action}</p>)}</section>
    </>}
  </section>;
}
