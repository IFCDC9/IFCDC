import React from 'react';
import type { Catalog, Crate } from '../../../../server/radio/catalog';
export type CatalogTrack = {id:string;title:string;duration:number;durationVerifiedAt?:string;catalog?:Catalog;catalogUpdatedAt?:string};
type Run = (fn:()=>Promise<void>)=>Promise<void>;
type Request = (url:string,options:RequestInit)=>Promise<void>;
const textFields = ['artist','genre','era','key','mood','kickBass','transitionNotes'] as const;
const labels:Record<string,string>={artist:'Artist',genre:'Genre',era:'Era',key:'Musical key',mood:'Mood',kickBass:'Kick and bass notes',transitionNotes:'Transition notes'};
const options={energy:['unknown','low','medium','high'],content:['unknown','clean','explicit'],category:['music','station-id','interview','advertisement','other'],vocalDensity:['unknown','instrumental','light','dense'],preference:['unreviewed','approved','favorite','rejected']} as const;
const optionLabels={energy:'Energy',content:'Clean / explicit',category:'Category',vocalDensity:'Vocal density',preference:'Your preference'};
export function TrackCatalog({track,canManage,busy,action,request}:{track:CatalogTrack;canManage:boolean;busy:boolean;action:Run;request:Request}) {
 const c=track.catalog;
 return <details className="border rounded p-3"><summary>Catalog: {track.title} · {c?.artist || 'Artist unknown'} · {c?.bpm ? `${c.bpm} BPM` : 'BPM unknown'} · {c?.preference || 'unreviewed'}</summary>
 <p>These are operator-entered tags. Sound analysis and transition compatibility have not been verified.</p>
 {c && <p>{[c.genre,c.era,c.key,c.mood,c.energy,c.content,c.category,c.vocalDensity].filter(Boolean).join(' · ')}</p>}
 {c && <p>{c.kickBass} {c.transitionNotes}</p>}
 {canManage && <form key={track.catalogUpdatedAt || 'new'} className="flex flex-wrap gap-3" onSubmit={e=>{
  e.preventDefault();const data=new FormData(e.currentTarget);const body:Record<string,unknown>={};
  for(const field of textFields) body[field]=String(data.get(field)||'');
  for(const field of Object.keys(options)) body[field]=String(data.get(field));
  body.bpm=data.get('bpm') ? Number(data.get('bpm')) : null;
  void action(()=>request(`/api/radio/library/${track.id}/catalog`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 }}>
 {textFields.map(field=><label key={field}>{labels[field]}<input className="block bg-background border rounded p-2" name={field} defaultValue={c?.[field] || ''} maxLength={field==='transitionNotes'?1000:field==='kickBass'?500:100}/></label>)}
 <label>BPM<input className="block bg-background border rounded p-2" name="bpm" type="number" min={20} max={300} step="0.01" defaultValue={c?.bpm ?? ''}/></label>
 {Object.entries(options).map(([field,values])=><label key={field}>{optionLabels[field as keyof typeof options]}<select className="block bg-background border rounded p-2" name={field} defaultValue={c?.[field as keyof typeof options] || values[0]}>{values.map(value=><option key={value} value={value}>{value}</option>)}</select></label>)}
 <button disabled={busy} className="border rounded p-2">Save catalog</button>
 </form>}
 </details>;
}
export function RadioCrates({crates,tracks,selected,setSelected,canManage,busy,action,request}:{crates:Crate[];tracks:CatalogTrack[];selected:string[];setSelected:(ids:string[])=>void;canManage:boolean;busy:boolean;action:Run;request:Request}) {
 return <section className="border rounded-xl p-5 space-y-3"><h2 className="text-xl font-semibold">Radio library and custom crates</h2>
 <p>Build a saved crate from catalog rules, or save your selected tracks in their current order. Builder results exclude rejected tracks and sort by BPM, with unknown BPM last. Crates are snapshots; review them before scheduling.</p>
 {canManage && <>
 <form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const name=String(new FormData(form).get('name'));void action(async()=>{await request('/api/radio/crates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,tracks:selected})});form.reset();});}}>
 <input aria-label="Selected crate name" name="name" placeholder="Selected crate name" maxLength={100} required className="bg-background border rounded p-2"/>
 <button className="border rounded p-2" disabled={busy || !selected.length}>Save selected tracks as crate</button></form>
 <details><summary>Build a crate from catalog rules</summary>
 <form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const d=new FormData(form);void action(async()=>{
  const rules={genre:String(d.get('genre')||''),mood:String(d.get('mood')||''),energy:String(d.get('energy')),cleanOnly:d.has('cleanOnly'),approvedOnly:d.has('approvedOnly'),minBpm:d.get('minBpm')?Number(d.get('minBpm')):null,maxBpm:d.get('maxBpm')?Number(d.get('maxBpm')):null};
  await request('/api/radio/crates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:d.get('name'),rules})});form.reset();
 });}}>
 <label>Crate name<input className="block bg-background border rounded p-2" name="name" required maxLength={100}/></label>
 {['genre','mood'].map(field=><label key={field}>{field}<input className="block bg-background border rounded p-2" name={field} maxLength={100}/></label>)}
 <label>Energy<select name="energy" className="block bg-background border rounded p-2">{['any','low','medium','high'].map(v=><option key={v}>{v}</option>)}</select></label>
 <label>Minimum BPM<input className="block bg-background border rounded p-2" name="minBpm" type="number" min={20} max={300} step="0.01"/></label>
 <label>Maximum BPM<input className="block bg-background border rounded p-2" name="maxBpm" type="number" min={20} max={300} step="0.01"/></label>
 <label><input name="cleanOnly" type="checkbox"/>Only tagged clean</label><label><input name="approvedOnly" type="checkbox"/>Only approved / favorites</label>
 <button className="border rounded p-2" disabled={busy}>Build and save crate</button>
 </form></details></>}
 {crates.length===0 && <p>No crates yet. Add catalog details to your tracks to begin.</p>}
 {crates.map(crate=><div className="border rounded p-3" key={crate.id}><h3>{crate.name} · {crate.tracks.length} tracks</h3>
 <p>{crate.tracks.map(id=>tracks.find(t=>t.id===id)?.title || 'Missing track').join(' → ')}</p>
 {canManage && <><button className="border rounded p-2" disabled={busy} onClick={()=>setSelected([...crate.tracks])}>Load into show selection</button> <button disabled={busy} onClick={()=>void action(()=>request(`/api/radio/crates/${crate.id}`,{method:'DELETE'}))}>Remove crate</button></>}
 </div>)}
 </section>;
}
