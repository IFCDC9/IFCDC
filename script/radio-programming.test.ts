import test from 'node:test';
import assert from 'node:assert/strict';
import { artistKeys, overlaps, eligibility, createProgram, programmingSchema, blockedForAir, transitionBpm } from '../server/radio/programming';
import { catalogSchema } from '../server/radio/catalog';
import type { Track, Station } from '../server/radio/station';
const rules=programmingSchema.parse({maxBpmStep:12});
const track=(id:string,artist:string,bpm=90,mood='soulful',extra:Record<string,unknown>={}):Track=>({id,title:id,filename:id+'.mp3',duration:180,catalog:catalogSchema.parse({artist,bpm,mood,version:'full',content:'clean',preference:'approved',...extra})});
test('programming builds a repeating artist-separated tempo/mood sequence including the loop boundary',()=>{
 const pool=[track('a1','Artist A',90),track('a2','Artist A',95),track('b','Artist B',94),track('c','Artist C',96),track('bad','Artist D',200,'angry'),track('unknown','Unknown',91),track('acap','Artist E',90,'soulful',{version:'acappella'})];
 const plan=createProgram(pool,rules);assert.ok(plan.tracks.length>=3);assert.equal(plan.excluded['A cappella excluded'],1);assert.equal(plan.excluded['Artist needs review'],1);
 for(let i=0;i<plan.tracks.length;i++){const a=pool.find(t=>t.id===plan.tracks[i])!,b=pool.find(t=>t.id===plan.tracks[(i+1)%plan.tracks.length])!;assert.ok(!overlaps(artistKeys(a),artistKeys(b)));assert.ok(transitionBpm(a.catalog!.bpm!,b.catalog!.bpm!)<=12);}
 assert.throws(()=>createProgram([track('a','Artist A'),track('b','Artist A')],rules),/No safe repeating rotation/);
});
test('featured artists, punctuation, acappella labels and missing data are held out safely',()=>{
 assert.ok(overlaps(artistKeys(track('a','Jay-Z feat. Beyoncé')),artistKeys(track('b','Beyoncé'))));
 assert.deepEqual(artistKeys(track('a','Jay-Z')),artistKeys(track('a','Jay Z')));
 for(const title of ['Song (Acapella)','Song a cappella','Acappella radio'])assert.equal(eligibility({...track('x','Artist'),title}),'A cappella excluded');
 assert.equal(eligibility(track('x','Artist',90,'')),'Mood needs review');
 assert.equal(eligibility(track('x','Artist',90,'soul',{version:'unknown'})),'Recording version needs review');
 assert.equal(eligibility(track('x','Artist',90,'soul'),programmingSchema.parse({mood:'angry'})),'Outside selected mood');
 assert.equal(transitionBpm(90,180),0);
});
test('persisted air history blocks adjacent matching artist across a show boundary and restart, but resumes its current song',()=>{
 const a=track('a','Artist A'),b=track('b','Artist B');const s:Station={tracks:[a,b],slots:[],log:[],programming:{...rules,enabled:true},airHistory:[{key:'old-show:0',trackId:a.id,artists:artistKeys(a),at:new Date().toISOString()}]};
 assert.ok(blockedForAir(s,'new-show:0',a).has('a'));assert.ok(!blockedForAir(s,'old-show:0',a).has('a'));assert.ok(!blockedForAir(s,'new-show:0',a).has('b'));
 s.tracks[0].catalog!.preference='rejected';assert.ok(blockedForAir(s,'old-show:0',a).has('a'));
});
