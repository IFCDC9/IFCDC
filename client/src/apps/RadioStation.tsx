import { RadioUpload } from '../components/radio/RadioUpload';
import '../../../public/radio-experience.css';
import { RadioTower, Headphones, ArrowUpRight, Disc3 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { RadioAutomation, localDateTime } from '../components/radio/RadioAutomation';
import type { RecurringShow, Fallback } from '../../../server/radio/automation';
import { TrackCatalog, RadioCrates, type CatalogTrack } from '../components/radio/RadioCatalog';
import type { Crate } from '../../../server/radio/catalog';
import { useAuth } from '../auth/AuthContext';
type Track = CatalogTrack;
type Slot = { id: string; title: string; start: string; tracks: string[] };
type State = { configured: boolean; recurring?:RecurringShow[]; fallback?:Fallback; crates?: Crate[]; playout?: { enabled: boolean; ready: boolean; mode: string; trackTitle?:string | null; error: string | null }; tracks: Track[]; slots: Slot[]; log: { at: string; action: string }[]; now: { track: Track; offset: number; index: number; slot: Slot } | null };
export default function RadioStation() {
  const { user } = useAuth();
  const canManage = ['admin', 'owner', 'founder'].includes(user?.role || '');
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [streamPlaying,setStreamPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const audio = useRef<HTMLAudioElement>(null);
  const streamAudio = useRef<HTMLAudioElement>(null);
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
    const key = `${now.slot.id}:${now.index}`;
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
    try { await fn(); await refresh(); } catch (e: any) { setError(e.message); requestAnimationFrame(() => document.querySelector('[role="alert"]')?.scrollIntoView({behavior:'smooth',block:'center'})); } finally { setBusy(false); }
  }
  async function request(url: string, options: RequestInit) {
    const res = await fetch(url, { ...options, credentials: 'include' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Request failed (${res.status})`); }
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
      const uploaded=await fetch(`/api/radio/library?${new URLSearchParams({title: file.name.replace(/\.mp3$/i,''), duration: String(duration)})}`, { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, credentials:'include', body: file });
      if(!uploaded.ok){const data=await uploaded.json().catch(()=>({}));throw new Error(data.error || `Upload failed (${uploaded.status})`);}
      return Boolean((await uploaded.json()).duplicate);
    } finally { URL.revokeObjectURL(url); }
  }
  const panels=[['overview','Overview'],['library','Audio library'],['crates','Custom crates'],['shows','Show schedule'],['automation','Automation'],['activity','Activity']];
  const upcoming=(state?.slots || []).filter(x=>Date.parse(x.start)>Date.now()).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(0,4);
  const displayName=user?.name || 'Station operator';
  async function tune() {
    const player=streamAudio.current;if(!player)return;
    if(!player.paused){player.pause();player.removeAttribute('src');player.load();return;}
    setListening(false);setError('');player.src='/api/radio/stream';
    try{await player.play();}catch{setError('The private stream is unavailable. Press Tune in to reconnect.');}
  }
  return <div className={`radio-experience ${streamPlaying ? 'r-playing' : ''}`}>
    <header className="r-top"><a className="r-brand" href="/hq"><img className="r-brand-logo" src="/ifcdc-radio-logo.webp" alt="" width="52" height="52"/> IFCDC <span style={{color:'var(--r-gold)'}}>RADIO</span></a><nav className="r-top-links" aria-label="Station navigation"><a href="/listen">Listener experience <ArrowUpRight size={13}/></a><a href="/hq">Back to HQ</a><span className="r-profile-badge" title={displayName}>{displayName.slice(0,1).toUpperCase()}</span></nav></header>
    <main className="r-wrap">
    <section className="r-hero"><div className="r-hero-copy"><span className="r-label">Your private station workspace</span><h1>Shape the sound.<br/><em>Move the culture.</em></h1><p>A home for your music, your voices and your next great show. Build the station your community deserves.</p><div className="r-hero-actions"><button className="r-primary" disabled={!state?.playout?.ready} onClick={()=>void tune()}><Headphones size={17}/>{streamPlaying ? 'Disconnect' : 'Tune in'}</button><button className="r-ghost" onClick={()=>setTab('library')}>Build your library <ArrowUpRight size={16}/></button></div><span className="r-status" data-ready={!!state?.playout?.ready}>{state?.playout?.ready ? 'Private stream connected' : 'Private stream preparing'}</span></div>
    <div className="r-signal" aria-hidden="true"><div className="r-signal-top"><span>IFCDC / STATION STUDIO</span><span>01 — INDEPENDENT SOUND</span></div><img className="r-hero-logo" src="/ifcdc-radio-logo.webp" alt="" width="1280" height="1280"/><div className="r-signal-bottom"><span>CONNECTED BY COMMUNITY</span><div className="r-bars">{Array.from({length:12},(_,i)=><i key={i}/>)}</div></div></div></section>
    {error && <p role="alert" className="r-alert">{error}</p>}
    {state?.playout?.error && <p role="alert" className="r-alert">{state.playout.error}</p>}
    <section className="r-player" aria-label="Private continuous stream"><div className="r-player-icon"><RadioTower size={26}/></div><div><span className="r-label" style={{marginBottom:5}}>Private continuous stream · {state?.playout?.mode || 'connecting'}</span><div className="r-player-title">{state?.playout?.trackTitle || state?.now?.track.title || 'Your next listening moment'}</div><p className="r-player-sub">{state?.now?.slot.title || 'Between shows. Fallback music or silence follows your station settings.'}</p></div><div><audio ref={streamAudio} controls preload="none" aria-label="Private station audio" src={state?.playout?.ready ? '/api/radio/stream' : undefined} onPlay={()=>{setListening(false);setStreamPlaying(true);}} onPause={()=>setStreamPlaying(false)} onEnded={()=>setStreamPlaying(false)} onError={()=>{setStreamPlaying(false);setError('The stream disconnected. Press Tune in to reconnect.');}}/></div></section>
    {!state ? <p role="status">Connecting to your station…</p> : <>
    {!state.configured && <p className="r-alert">Station storage needs setup. Configure RADIO_DATA_DIR on your persistent disk before uploading or scheduling.</p>}
    <nav className="r-tabs" aria-label="Station sections" role="tablist">{panels.map(([id,label])=><button key={id} id={`station-tab-${id}`} role="tab" aria-controls="station-panel" aria-selected={tab===id} tabIndex={tab===id?0:-1} onKeyDown={e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const index=panels.findIndex(p=>p[0]===id);const next=e.key==='Home'?0:e.key==='End'?panels.length-1:(index+(e.key==='ArrowRight'?1:-1)+panels.length)%panels.length;setTab(panels[next][0]);document.getElementById(`station-tab-${panels[next][0]}`)?.focus();}} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    <div id="station-panel" role="tabpanel" aria-labelledby={`station-tab-${tab}`} className="r-content">
    {tab==='overview' && <>
      <div className="r-stats"><div className="r-stat"><strong>{state.tracks.length.toString().padStart(2,'0')}</strong><span>Tracks in your orbit</span></div><div className="r-stat"><strong>{(state.crates?.length || 0).toString().padStart(2,'0')}</strong><span>Custom crates</span></div><div className="r-stat"><strong>{(state.recurring?.length || 0).toString().padStart(2,'0')}</strong><span>Recurring shows</span></div></div>
      <div className="r-grid"><section className="r-card"><div className="r-card-head"><div><span className="r-label">The next chapter</span><h2>Your station, in motion.</h2></div><Disc3 size={30} color="#f1cb78"/></div><p>Start with a track. Give it a home in a crate. Turn your selection into a show, then let your schedule carry the sound.</p><div className="r-row"><div><strong>01 / Curate your sound</strong><p>Catalog artists, BPM, moods and your preferences.</p></div><button className="r-ghost" onClick={()=>setTab('library')} aria-label="Open audio library">↗</button></div><div className="r-row"><div><strong>02 / Create a collection</strong><p>Build an ordered crate around your show.</p></div><button className="r-ghost" onClick={()=>setTab('crates')} aria-label="Open custom crates">↗</button></div><div className="r-row"><div><strong>03 / Keep the signal moving</strong><p>Set recurring shows and an approved fallback rotation.</p></div><button className="r-ghost" onClick={()=>setTab('automation')} aria-label="Open station automation">↗</button></div></section>
      <aside className="r-card"><span className="r-label">On the horizon</span><h2>Coming up next</h2>{upcoming.length ? upcoming.map(slot=><div className="r-row" key={slot.id}><div><strong>{slot.title}</strong><p>{new Date(slot.start).toLocaleString()}</p></div></div>) : <div className="r-empty"><span>◷</span><p>No one-off shows queued yet.</p><button className="r-ghost" onClick={()=>setTab('shows')}>Plan a show ↗</button></div>}<div style={{marginTop:24,borderTop:'1px solid var(--r-line)',paddingTop:20}}><p className="r-small">Welcome, {displayName}. This workspace controls the station. Your community listens through the public experience.</p><a className="r-button r-ghost" href="/listen">Open listener experience ↗</a></div></aside></div>
      <details style={{marginTop:22}}><summary>Scheduled-track preview</summary>      <section className="r-card"><h2 className="text-xl font-semibold">Scheduled now</h2>
        <p>{state.now ? `${state.now.slot.title} — ${state.now.track.title}` : 'No scheduled audio playing'}</p>
        <button className="border rounded px-4 py-2" disabled={!state.now} onClick={() => { streamAudio.current?.pause(); setListening(!listening); }}>{listening ? 'Stop listening' : 'Listen to scheduled audio'}</button>
        <audio ref={audio} onEnded={() => { current.current = ''; refresh().catch(e => setError(e.message)); }} onError={() => { setListening(false); current.current = ''; setError('Audio could not be loaded. Check the media file and connection.'); }} />
        <p className="text-sm">Listening follows the show clock. This browser preview is not a continuous broadcast stream.</p>
      </section>
</details>
    </>}
    {tab==='library' && <>      <section className="border rounded-xl p-5 space-y-3"><h2 className="text-xl font-semibold">Audio library ({state.tracks.length})</h2>
        {canManage && <RadioUpload disabled={busy || !state.configured} upload={upload} refresh={refresh}/> }
        {state.tracks.length === 0 && <p>Upload your first recording or station ID to begin.</p>}
        <label>Search catalog<input className="block bg-background border rounded p-2" value={catalogSearch} onChange={e=>setCatalogSearch(e.target.value)} placeholder="Title, artist, genre, mood, or sound notes"/></label>
        {state.tracks.filter(t=>`${t.title} ${JSON.stringify(t.catalog || {})}`.toLocaleLowerCase().includes(catalogSearch.toLocaleLowerCase())).map(t => <div key={t.id}><label className="r-track-select"><input aria-label={`Select ${t.title}`} type="checkbox" disabled={!canManage} checked={selected.includes(t.id)} onChange={e => setSelected(e.target.checked ? [...selected,t.id] : selected.filter(id => id !== t.id))}/><span>{t.title} · {Math.round(t.duration)} sec · {t.durationVerifiedAt ? 'duration verified' : 'legacy duration unverified'}</span></label><TrackCatalog track={t} canManage={canManage} busy={busy} action={action} request={request}/></div>)}
        {selected.length > 0 && <p>Playback order: {selected.map(id => state.tracks.find(t => t.id === id)?.title).join(' → ')} <button onClick={() => setSelected([])}>Clear</button></p>}
      </section>
</>}
    {tab==='crates' && <>      <RadioCrates crates={state.crates || []} tracks={state.tracks} selected={selected} setSelected={setSelected} canManage={canManage} busy={busy || !state.configured} action={action} request={request}/>
</>}
    {tab==='shows' && <>      <section className="border rounded-xl p-5 space-y-3"><h2 className="text-xl font-semibold">Show schedule</h2>
        {canManage && <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); const form=e.currentTarget; const data=new FormData(form); action(async () => { await request('/api/radio/schedule', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:data.get('title'),start:new Date(String(data.get('start'))).toISOString(),tracks:selected})}); form.reset(); setSelected([]); }); }}>
          <input className="bg-background border rounded p-2" name="title" placeholder="Show title" aria-label="Show title" maxLength={200} required />
          <label>Start (your local time)<input className="block bg-background border rounded p-2" name="start" type="datetime-local" defaultValue={localDateTime()} required /></label>
          <button className="border rounded p-2" disabled={busy || !state.configured || !selected.length}>Schedule selected tracks</button>
        </form>}
        <p className="text-sm">Select tracks in playback order above. Newer scheduled shows interrupt older shows. Times are saved in UTC.</p>
        {state.slots.length === 0 && <p>No shows scheduled yet.</p>}
        {[...state.slots].sort((a,b) => Date.parse(a.start)-Date.parse(b.start)).map(s => <div className="flex flex-wrap justify-between gap-3 border-b p-2" key={s.id}><span>{s.title} · {new Date(s.start).toLocaleString()} · {s.tracks.length} tracks</span>{canManage && <button disabled={busy} onClick={() => action(() => request(`/api/radio/schedule/${s.id}`,{method:'DELETE'}))}>Remove show</button>}</div>)}
      </section>
</>}
    {tab==='automation' && <>      <RadioAutomation recurring={state.recurring || []} fallback={state.fallback} tracks={state.tracks} selected={selected} canManage={canManage} busy={busy || !state.configured} action={action} request={request}/>
</>}
    {tab==='activity' && <>      <section className="border rounded-xl p-5"><h2 className="text-xl font-semibold">Station activity</h2>{state.log.slice(-10).reverse().map((entry,i) => <p key={i}>{new Date(entry.at).toLocaleString()} — {entry.action}</p>)}</section></>}
    </div></>}
    </main><footer className="r-footer r-wrap"><span>IFCDC RADIO — INDEPENDENT VOICES. ONE COMMUNITY.</span><span>Station studio · Private HQ access · <a href="/listen">Listener experience ↗</a></span></footer>
  </div>;
}
