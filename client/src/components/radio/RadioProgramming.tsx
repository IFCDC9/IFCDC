import React, { useRef, useState } from 'react';
import type { Programming, ProgrammingRules } from '../../../../server/radio/programming';
import type { CatalogTrack } from './RadioCatalog';
type Report={eligible:number;unused:number;minutes:number;tracks:string[];excluded:Record<string,number>;preview:{title:string;artist:string;bpm:number;mood:string}[]};
export function RadioProgramming({tracks,programming,canManage,busy,action,request}:{tracks:CatalogTrack[];programming?:Programming;canManage:boolean;busy:boolean;action:(fn:()=>Promise<void>)=>Promise<void>;request:(url:string,options:RequestInit)=>Promise<void>}){
 const [report,setReport]=useState<Report|null>(null),[rules,setRules]=useState<ProgrammingRules|null>(null),[progress,setProgress]=useState('');
 const stop=useRef(false);
 return <section className="r-card"><h3>Artist-separated tempo and mood programming</h3>
 <p>{programming?.enabled?'Programming guards are active.':'Programming guards are not enabled yet.'} Automatic music must be tagged clean, approved/favorite, full or instrumental, and have artist, BPM and mood. A cappellas are excluded. Different artist credits are required between music tracks, including featured artists.</p>
 <p>Tempo matching accepts half/double-time BPM equivalents. This orders compatible tracks; it does not beat-mix or crossfade them. Missing files, insufficient eligible music or encoder faults can still cause silence.</p>
 {canManage && <>
 <button className="r-ghost" disabled={busy || !tracks.length} onClick={()=>void action(async()=>{
  stop.current=false;let done=0;const issues:string[]=[];
  for(const track of tracks){if(stop.current)break;setProgress(`Reading embedded tags ${done+1} / ${tracks.length}: ${track.title}`);try{await request(`/api/radio/library/${track.id}/read-tags`,{method:'POST'});}catch(e){issues.push(`${track.title}: ${e instanceof Error?e.message:'Failed'}`);if([401,403,503,507].includes((e as any)?.status))stop.current=true;}done++;}
  setProgress(`Read ${done} tracks. ${issues.length} issues.${issues.length?' '+issues.slice(0,3).join('; '):''} Missing BPM or mood still needs review.`);
 })}>Read embedded tags from existing music</button>
 {busy && <button type="button" className="r-ghost" onClick={()=>{stop.current=true;}}>Stop tag scan after current track</button>}
 <p role="status">{progress}</p>
 <form onChange={()=>setReport(null)} onSubmit={event=>{
  event.preventDefault();const data=new FormData(event.currentTarget);
  const value={mood:String(data.get('mood')||''),energy:String(data.get('energy')||'any') as ProgrammingRules['energy'],maxBpmStep:Number(data.get('maxBpmStep'))};
  void action(async()=>{const response=await fetch('/api/radio/programming/preview',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(30000)});const result=await response.json();if(!response.ok)throw new Error(result.error || 'Unable to build rotation');setRules(value);setReport(result);});
 }}>
 <label>Mood filter (blank allows transitions between moods)<input name="mood" maxLength={100} defaultValue={programming?.mood || ''}/></label>
 <label>Energy<select name="energy" defaultValue={programming?.energy || 'any'}>{['any','low','medium','high'].map(value=><option key={value}>{value}</option>)}</select></label>
 <label>Maximum BPM step<input name="maxBpmStep" type="number" min={1} max={40} defaultValue={programming?.maxBpmStep || 12} required/></label>
 <button className="r-ghost" disabled={busy}>Preview compatible rotation</button>
 </form>
 {report && <div><p>{report.tracks.length} tracks · {report.minutes} minutes per loop · {report.unused} eligible tracks could not fit this loop safely. The closing-to-opening transition is checked too.</p>
 {Object.entries(report.excluded).map(([reason,count])=><p key={reason}>{reason}: {count}</p>)}
 <ol>{report.preview.map((track,index)=><li key={index}>{track.title} · {track.artist} · {track.bpm} BPM · {track.mood}</li>)}</ol>
 <button className="r-primary" disabled={busy} onClick={()=>void action(async()=>{await request('/api/radio/programming/enable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rules)});setReport(null);setProgress('Programming enabled. The reviewed rotation replaces fallback and runs between shows.');})}>Enable reviewed rotation and artist guards</button></div>}
 {programming?.enabled && <button className="r-ghost" disabled={busy} onClick={()=>void action(()=>request('/api/radio/programming/disable',{method:'POST'}))}>Disable programming guards</button>}
 </>}
 </section>;
}
