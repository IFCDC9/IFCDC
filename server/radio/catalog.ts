import { z } from 'zod';
import type { Track } from './station';
const label = z.string().trim().max(100);
export const catalogSchema = z.object({
  artist: label.default(''), genre: label.default(''), era: label.default(''),
  bpm: z.number().min(20).max(300).nullable().default(null), key: label.default(''),
  mood: label.default(''), energy: z.enum(['unknown','low','medium','high']).default('unknown'),
  content: z.enum(['unknown','clean','explicit']).default('unknown'),
  category: z.enum(['music','station-id','interview','advertisement','other']).default('music'),
  kickBass: z.string().trim().max(500).default(''),
  vocalDensity: z.enum(['unknown','instrumental','light','dense']).default('unknown'),
  transitionNotes: z.string().trim().max(1000).default(''),
  preference: z.enum(['unreviewed','approved','favorite','rejected']).default('unreviewed'),
}).strict();
export type Catalog = z.infer<typeof catalogSchema>;
export const crateRulesSchema = z.object({
  genre: label.default(''), mood: label.default(''),
  energy: z.enum(['any','low','medium','high']).default('any'),
  cleanOnly: z.boolean().default(false), approvedOnly: z.boolean().default(false),
  minBpm: z.number().min(20).max(300).nullable().default(null),
  maxBpm: z.number().min(20).max(300).nullable().default(null),
}).strict().refine(r=>r.minBpm === null || r.maxBpm === null || r.minBpm <= r.maxBpm,{message:'Minimum BPM must not exceed maximum BPM'});
export type CrateRules = z.infer<typeof crateRulesSchema>;
export type Crate = { id:string; name:string; tracks:string[]; createdAt:string; rules?:CrateRules };
export function buildCrate(tracks: Track[], rules: CrateRules) {
  const same=(a:string,b:string)=>a.toLocaleLowerCase()===b.toLocaleLowerCase();
  return tracks.filter(t=>{
    const c=t.catalog;
    if(c?.preference==='rejected') return false;
    if(rules.approvedOnly && !['approved','favorite'].includes(c?.preference || '')) return false;
    if(rules.cleanOnly && c?.content !== 'clean') return false;
    if(rules.genre && !same(c?.genre || '',rules.genre)) return false;
    if(rules.mood && !same(c?.mood || '',rules.mood)) return false;
    if(rules.energy !== 'any' && c?.energy !== rules.energy) return false;
    if(rules.minBpm !== null && (c?.bpm == null || c.bpm < rules.minBpm)) return false;
    if(rules.maxBpm !== null && (c?.bpm == null || c.bpm > rules.maxBpm)) return false;
    return true;
  }).sort((a,b)=>(a.catalog?.bpm ?? Infinity)-(b.catalog?.bpm ?? Infinity) || a.title.localeCompare(b.title)).map(t=>t.id);
}
