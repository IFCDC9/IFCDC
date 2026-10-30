import React from 'react';
import type { RecurringShow, Fallback } from '../../../../server/radio/automation';
import type { CatalogTrack } from './RadioCatalog';
export function localDateTime(date=new Date(Date.now()+120000)) {return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function RadioAutomation({recurring,fallback,tracks,selected,canManage,busy,action,request}:{recurring:RecurringShow[];fallback?:Fallback;tracks:CatalogTrack[];selected:string[];canManage:boolean;busy:boolean;action:(fn:()=>Promise<void>)=>Promise<void>;request:(url:string,options:RequestInit)=>Promise<void>}) {
 const send=(url:string,body:unknown,method='POST')=>request(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 return <section className="border rounded-xl p-5 space-y-3"><h2 className="text-xl font-semibold">Daily station automation</h2>
 <p>Use the current show selection, including any station IDs, to create a recurring show. Newer show starts interrupt earlier shows. Completed shows give way to fallback music or silence.</p>
 {canManage && <details><summary>Create a recurring show</summary><form className="flex flex-wrap gap-3" onSubmit={e=>{
  e.preventDefault();const form=e.currentTarget;const d=new FormData(form);void action(async()=>{
   await send('/api/radio/recurring',{title:d.get('title'),startDate:d.get('startDate'),time:d.get('time'),timezone:d.get('timezone'),weekdays:d.getAll('weekdays').map(Number),tracks:selected});form.reset();
  });
 }}>
 <label>Show title<input className="block bg-background border rounded p-2" name="title" maxLength={200} required/></label>
 <label>First local date<input className="block bg-background border rounded p-2" name="startDate" type="date" defaultValue={localDateTime().slice(0,10)} required/></label>
 <label>Local start time<input className="block bg-background border rounded p-2" name="time" type="time" defaultValue={localDateTime().slice(11)} required/></label>
 <label>Timezone<input className="block bg-background border rounded p-2" name="timezone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'} required maxLength={100}/></label>
 <fieldset><legend>Repeat on</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((name,index)=><label key={name}><input type="checkbox" name="weekdays" value={index} defaultChecked/>{name} </label>)}</fieldset>
 <button className="border rounded p-2" disabled={busy || !selected.length}>Save recurring show</button>
 </form><p>Times follow the selected timezone through daylight saving changes. A missing spring-forward time is skipped; a repeated fall-back time runs once at its first occurrence. Shows do not run retroactively before creation.</p></details>}
 {recurring.length===0 && <p>No recurring shows yet.</p>}
 {recurring.map(show=><div key={show.id} className="border-b p-2"><p>{show.title} · {show.time} {show.timezone} · {show.weekdays.map(day=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]).join(', ')} · from {show.startDate} · {show.tracks.length} tracks</p>
 {canManage && <button disabled={busy} onClick={()=>void action(()=>request(`/api/radio/recurring/${show.id}`,{method:'DELETE'}))}>Remove recurring show</button>}</div>)}
 <h3 className="font-semibold">Fallback rotation</h3><p>Plays between shows and when a show track cannot be played. Only tracks tagged clean and approved or favorite qualify. Changing those tags immediately removes a track from fallback eligibility.</p>
 <p>{fallback?.tracks.length ? fallback.tracks.map(id=>tracks.find(t=>t.id===id)?.title || 'Missing track').join(' → ') : 'No fallback configured; gaps play silence.'}</p>
 {canManage && <><button className="border rounded p-2" disabled={busy || !selected.length} onClick={()=>void action(()=>send('/api/radio/fallback',{tracks:selected},'PUT'))}>Use selection as fallback</button> <button disabled={busy || !fallback?.tracks.length} onClick={()=>void action(()=>send('/api/radio/fallback',{tracks:[]},'PUT'))}>Clear fallback</button></>}
 <p>Saved shows and rotations recover their clock position after restart. Streaming connections need to be reopened after a deployment.</p>
 </section>;
}
