import { z } from 'zod';
import type { Track, Station } from './station';
export const programmingSchema=z.object({mood:z.string().trim().max(100).default(''),energy:z.enum(['any','low','medium','high']).default('any'),maxBpmStep:z.number().min(1).max(40).default(12)}).strict();
export type ProgrammingRules=z.infer<typeof programmingSchema>;
export type Programming=ProgrammingRules & {enabled:boolean};
export type AirHistory={key:string;trackId:string;artists:string[];at:string};
export function artistKeys(track:Track) {
 const value=track.catalog?.artist || '';
 if(/^(unknown|unknown artist|various artists|n\/?a)$/i.test(value.trim()))return [];
 return [...new Set(value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().split(/\s*(?:feat\.?|ft\.?|featuring|with|&|;|,|\bx\b)\s*/i).map(s=>s.replace(/[^\p{L}\p{N}]/gu,'')).filter(Boolean))];
}
export const overlaps=(a:string[],b:string[])=>a.some(artist=>b.includes(artist));
export function isAcappella(track:Track){return track.catalog?.version==='acappella' || /\ba[\s-]*ca?p+p?ell?a?s?\b/i.test(track.title);}
export function eligibility(track:Track,rules?:ProgrammingRules):string|null {
 const c=track.catalog;
 if(c?.content!=='clean' || !['approved','favorite'].includes(c.preference))return 'Not reviewed clean and approved';
 if(isAcappella(track))return 'A cappella excluded';
 if(c.category!=='music')return 'Not a music track';
 if(!['full','instrumental'].includes(c.version || 'unknown'))return 'Recording version needs review';
 if(!artistKeys(track).length)return 'Artist needs review';
 if(!c.bpm)return 'BPM needs review';
 if(!c.mood)return 'Mood needs review';
 if(rules?.mood && c.mood.toLowerCase()!==rules.mood.toLowerCase())return 'Outside selected mood';
 if(rules?.energy!=='any' && rules?.energy && c.energy!==rules.energy)return 'Outside selected energy';
 if(!Number.isFinite(track.duration) || track.duration<=0)return 'Duration needs review';
 return null;
}
export function transitionBpm(a:number,b:number){return Math.min(Math.abs(a-b),Math.abs(a-b*2),Math.abs(a*2-b));}
export function createProgram(tracks:Track[],rules:ProgrammingRules){
 const excluded:Record<string,number>={};const pool=tracks.filter(track=>{const reason=eligibility(track,rules);if(reason){excluded[reason]=(excluded[reason]||0)+1;return false;}return true;});
 const remaining=[...pool].sort((a,b)=>a.catalog!.bpm!-b.catalog!.bpm! || a.id.localeCompare(b.id));const order:Track[]=[];
 if(remaining.length)order.push(remaining.shift()!);
 while(remaining.length){
  const previous=order.at(-1)!;let best=-1,score=Infinity;
  for(let i=0;i<remaining.length;i++){
   const candidate=remaining[i];if(overlaps(artistKeys(previous),artistKeys(candidate)))continue;
   const gap=transitionBpm(previous.catalog!.bpm!,candidate.catalog!.bpm!);if(gap>rules.maxBpmStep)continue;
   const value=gap+(previous.catalog!.mood.toLowerCase()===candidate.catalog!.mood.toLowerCase()?0:6)+(previous.catalog!.energy===candidate.catalog!.energy?0:3);
   if(value<score){score=value;best=i;}
  }
  if(best<0)break;order.push(remaining.splice(best,1)[0]);
 }
 // Every loop boundary must satisfy the same artist and tempo rules.
 while(order.length>1 && (overlaps(artistKeys(order[0]),artistKeys(order.at(-1)!)) || transitionBpm(order[0].catalog!.bpm!,order.at(-1)!.catalog!.bpm!)>rules.maxBpmStep))remaining.push(order.pop()!);
 if(order.length<2)throw Object.assign(new Error('No safe repeating rotation yet. Review artist, BPM, mood, clean/approval and recording version tags. At least two compatible tracks by different artists are required.'),{status:400});
 return {tracks:order.map(t=>t.id),eligible:pool.length,excluded,unused:remaining.length,minutes:Math.round(order.reduce((sum,t)=>sum+t.duration,0)/60),preview:order.slice(0,30).map(t=>({title:t.title,artist:t.catalog!.artist,bpm:t.catalog!.bpm,mood:t.catalog!.mood}))};
}
/** Applied by the encoder only at a track boundary; the current song is never self-blocked. */
export function blockedForAir(state:Station,key:string,track:Track):Set<string>{
 const blocked=new Set<string>();if(!state.programming?.enabled)return blocked;
 const last=state.airHistory?.at(-1);const resuming=last?.key===key && last.trackId===track.id;
 for(const candidate of state.tracks){
  const isId=candidate.catalog?.category==='station-id' && candidate.catalog.content==='clean' && ['approved','favorite'].includes(candidate.catalog.preference);
  if(isId)continue;
  if(eligibility(candidate,state.programming) || (!resuming && last && overlaps(artistKeys(candidate),last.artists)))blocked.add(candidate.id);
 }
 return blocked;
}
