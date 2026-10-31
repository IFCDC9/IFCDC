import { z } from 'zod';
import type { Slot, Station } from './station';
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(`${s}T12:00:00Z`);return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;},'Choose a valid date');
export const recurrenceSchema=z.object({title:z.string().trim().min(1).max(200),startDate:dateSchema,time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timezone:z.string().max(100).refine(t=>{try {new Intl.DateTimeFormat('en-US',{timeZone:t});return true;}catch{return false;}},'Unknown timezone'),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),tracks:z.array(z.string().uuid()).min(1).max(5000)}).strict();
export type RecurringShow=z.infer<typeof recurrenceSchema>&{id:string;createdAt:string};
export type Fallback={tracks:string[];anchor:string};
const formatters=new Map<string,Intl.DateTimeFormat>();
function parts(time:number,timezone:string){
 let formatter=formatters.get(timezone);
 if(!formatter){
  if(formatters.size>=128)formatters.delete(formatters.keys().next().value!);
  formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formatters.set(timezone,formatter);
 }
 const p=formatter.formatToParts(time);
 const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${v.year}-${v.month}-${v.day}`,time:`${v.hour}:${v.minute}`,stamp:Date.UTC(+v.year,+v.month-1,+v.day,+v.hour,+v.minute,+v.second)};
}
/** Earliest repeated-hour occurrence; skip nonexistent spring-forward times. */
const occurrenceCache=new Map<string,number|null>();
export function occurrence(date:string,time:string,timezone:string):number|null {
 const key=JSON.stringify([date,time,timezone]);if(occurrenceCache.has(key))return occurrenceCache.get(key)!;
 const target=Date.parse(`${date}T${time}:00Z`);const candidates=new Set<number>();
 for(const delta of [-86400000,0,86400000]){
  const sample=target+delta;const offset=parts(sample,timezone).stamp-sample;const candidate=target-offset;
  const local=parts(candidate,timezone);if(local.date===date&&local.time===time)candidates.add(candidate);
 }
 const result=candidates.size ? Math.min(...candidates) : null;
 if(occurrenceCache.size>=2000)occurrenceCache.delete(occurrenceCache.keys().next().value!);
 occurrenceCache.set(key,result);return result;
}
export function recurringSlots(shows:RecurringShow[],now:number):Slot[]{
 const slots:Slot[]=[];
 for(const show of shows){
  const today=parts(now,show.timezone).date;const localDay=Date.parse(`${today}T12:00:00Z`);
  for(let day=0;day<8;day++){
   const date=new Date(localDay-day*86400000).toISOString().slice(0,10);
   if(date<show.startDate || !show.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()))continue;
   const start=occurrence(date,show.time,show.timezone);
   if(start===null||start>now||start<Date.parse(show.createdAt))continue;
   slots.push({id:`${show.id}:${start}`,title:show.title,start:new Date(start).toISOString(),tracks:show.tracks});break;
  }
 }
 return slots;
}
export function fallbackSelection(state:Station,now:number,excluded:ReadonlySet<string>=new Set()) {
 const config=state.fallback;if(!config?.tracks.length)return null;
 const tracks=config.tracks.map(id=>state.tracks.find(t=>t.id===id)).filter(t=>t && !excluded.has(t.id) && t.catalog?.content==='clean' && ['approved','favorite'].includes(t.catalog.preference) && Number.isFinite(t.duration)&&t.duration>0);
 const duration=tracks.reduce((n,t)=>n+t!.duration,0);const elapsed=(now-Date.parse(config.anchor))/1000;
 if(!duration||!Number.isFinite(elapsed)||elapsed<0)return null;
 const cycle=Math.floor(elapsed/duration);let offset=elapsed%duration;
 const slot:Slot={id:`fallback:${config.anchor}:${cycle}`,title:'Fallback rotation',start:new Date(now-offset*1000).toISOString(),tracks:tracks.map(t=>t!.id)};
 for(const [index,track] of tracks.entries()){if(offset<track!.duration)return {slot,track:track!,index,offset};offset-=track!.duration;}
 return null;
}
