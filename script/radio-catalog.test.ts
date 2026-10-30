import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildCrate, catalogSchema, crateRulesSchema } from '../server/radio/catalog';
import { StationStore, type Track } from '../server/radio/station';
function track(id:string,fields:Record<string,unknown>={}):Track {return {id,title:id,filename:`${id}.mp3`,duration:10,catalog:catalogSchema.parse(fields)};}
test('rule crates exclude rejected, unknown clean tags and unknown BPM, respecting approvals and case',()=>{
 const tracks=[track('fast',{genre:'Hip Hop',bpm:100,content:'clean',preference:'favorite'}),track('slow',{genre:'hip hop',bpm:80,content:'clean',preference:'approved'}),track('rejected',{genre:'Hip Hop',bpm:90,content:'clean',preference:'rejected'}),track('unknown',{genre:'Hip Hop',bpm:90}),track('no-bpm',{genre:'Hip Hop',content:'clean',preference:'approved'})];
 assert.deepEqual(buildCrate(tracks,crateRulesSchema.parse({genre:'HIP HOP',cleanOnly:true,approvedOnly:true,minBpm:70,maxBpm:110})),['slow','fast']);
 assert.deepEqual(buildCrate(tracks,crateRulesSchema.parse({cleanOnly:true})),['slow','fast','no-bpm']);
 assert.ok(!buildCrate(tracks,crateRulesSchema.parse({})).includes('rejected'));
 assert.deepEqual(buildCrate(tracks,crateRulesSchema.parse({mood:'calm'})),[]);
});
test('invalid BPM range, metadata mutation fields and invented preference values are rejected',()=>{
 assert.equal(crateRulesSchema.safeParse({minBpm:120,maxBpm:80}).success,false);
 assert.equal(catalogSchema.safeParse({bpm:999}).success,false);
 assert.equal(catalogSchema.safeParse({filename:'/etc/passwd'}).success,false);
 assert.equal(catalogSchema.safeParse({preference:'auto-approved'}).success,false);
});
test('legacy library adds catalog and crates without changing existing audio or schedules, surviving reopen',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'radio-catalog-'));
 try {
  const legacy={tracks:[{id:'old',title:'Original',filename:'old.mp3',duration:10}],slots:[{id:'show',title:'Show',start:new Date().toISOString(),tracks:['old']}],log:[]};
  await writeFile(path.join(dir,'station.json'),JSON.stringify(legacy));await writeFile(path.join(dir,'old.mp3'),'unchanged');
  const store=new StationStore(dir);
  await store.update('founder','catalog',s=>{s.tracks[0].catalog=catalogSchema.parse({artist:'Artist',preference:'favorite'});s.crates=[{id:'crate',name:'Favorites',tracks:['old'],createdAt:new Date().toISOString()}];});
  const reopened=await new StationStore(dir).read();
  assert.deepEqual(reopened.slots,legacy.slots);assert.equal(reopened.tracks[0].duration,10);assert.equal(reopened.tracks[0].catalog?.artist,'Artist');assert.equal(reopened.crates?.[0].tracks[0],'old');assert.equal(await readFile(path.join(dir,'old.mp3'),'utf8'),'unchanged');
 } finally {await rm(dir,{recursive:true,force:true});}
});
