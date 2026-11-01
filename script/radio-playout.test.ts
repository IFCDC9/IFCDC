import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { RadioPlayout } from '../server/radio/playout';
import { catalogSchema } from '../server/radio/catalog';
import { StationStore } from '../server/radio/station';
const delay = (ms:number) => new Promise(r => setTimeout(r,ms));
async function until(check:()=>boolean, timeout=15000) {
 const end=Date.now()+timeout;
 while (!check()) { if(Date.now()>end) throw new Error('Timed out waiting for playout'); await delay(100); }
}
test('real FFmpeg streams without listeners, follows schedule, returns to silence and stops', {timeout:30000}, async () => {
 const dir=await mkdtemp(path.join(os.tmpdir(),'radio-playout-'));
 const store=new StationStore(dir); const playout=new RadioPlayout(store);
 const app=express(); app.get('/stream',(_req,res)=>playout.listen(res)); const server=app.listen(0,'127.0.0.1');
 try {
  await store.update('test','initialize',()=>{});
  const generated=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=4','-c:a','libmp3lame',path.join(dir,'a.mp3')]);
  assert.equal(generated.status,0,generated.stderr.toString());
  await store.update('test','seed',s=>{s.tracks.push({id:'a',title:'Tone',filename:'a.mp3',duration:4});});
  playout.start(); assert.equal(playout.status().ready,false);
  await until(()=>playout.status().ready);
  assert.equal(playout.status().mode,'silence'); assert.equal(playout.status().listeners,0);
  const before=playout.status().bytes; await delay(300); assert.ok(playout.status().bytes>before);
  const address=server.address() as {port:number};
  const response=await fetch(`http://127.0.0.1:${address.port}/stream`);
  assert.equal(response.headers.get('content-type'),'audio/mpeg');
  const reader=response.body!.getReader(); const first=await reader.read(); assert.ok(first.value!.length>0); await reader.cancel();
  await store.update('test','schedule',s=>{s.slots.push({id:'show',title:'Test',start:new Date(Date.now()).toISOString(),tracks:['a']});});
  await until(()=>playout.status().mode==='scheduled');
  await until(()=>playout.status().mode==='silence');
  assert.equal(playout.status().error,null);
  await store.update('test','fallback',s=>{s.tracks[0].catalog=catalogSchema.parse({content:'clean',preference:'approved'});s.fallback={tracks:['a'],anchor:new Date().toISOString()};});
  await until(()=>playout.status().mode==='fallback');
  await store.update('test','missing show',s=>{s.tracks.push({id:'b',title:'Missing',filename:'b.mp3',duration:60});s.slots.push({id:'missing',title:'Missing',start:new Date().toISOString(),tracks:['b']});});
  await until(()=>playout.status().mode==='fallback' && !!playout.status().error);
  assert.equal(playout.status().trackTitle,'Tone');
  await writeFile(path.join(dir,'c.mp3'),'corrupt');
  await store.update('test','corrupt show',s=>{s.tracks.push({id:'c',title:'Corrupt',filename:'c.mp3',duration:60});s.slots.push({id:'corrupt',title:'Corrupt',start:new Date().toISOString(),tracks:['c']});});
  await until(()=>playout.status().mode==='fallback' && !!playout.status().error?.includes('decoder failed'));
  const recoveredBytes=playout.status().bytes;await until(()=>playout.status().bytes>recoveredBytes,5000);
  // Same persisted rotation resumes after constructing a fresh worker.
  playout.stop();const restarted=new RadioPlayout(new StationStore(dir));
  try {restarted.start();await until(()=>restarted.status().ready && restarted.status().mode==='fallback');}finally{restarted.stop();}
  playout.stop(); assert.equal(playout.status().ready,false); assert.equal(playout.status().enabled,false);
 } finally { playout.stop(); server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); await rm(dir,{recursive:true,force:true}); }
});
test('missing manifest preserves orphaned media and blocks empty-library overwrite', async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'radio-orphan-'));
 try {await writeFile(path.join(dir,'a.mp3'),'audio'); await assert.rejects(new StationStore(dir).read(),/manifest is missing/);}
 finally {await rm(dir,{recursive:true,force:true});}
});
test('missing FFmpeg reports failure and can be stopped', {timeout:10000}, async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'radio-no-ffmpeg-')); const playout=new RadioPlayout(new StationStore(dir),'/nonexistent/ffmpeg');
 try {playout.start(); await until(()=>!!playout.status().error,5000); assert.equal(playout.status().ready,false);}
 finally {playout.stop(); await rm(dir,{recursive:true,force:true});}
});

test('programmed playout replaces adjacent same-artist show music without bouncing between tracks each tick', {timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'radio-separated-'));const store=new StationStore(dir);const worker=new RadioPlayout(store);
 try {
  await store.update('test','initialize',()=>{});
  for(const name of ['a','b']){const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=400:duration=8','-c:a','libmp3lame',path.join(dir,name+'.mp3')]);assert.equal(result.status,0);}
  const anchor=new Date().toISOString();
  const a={id:'a',title:'Artist A',filename:'a.mp3',duration:8,catalog:catalogSchema.parse({artist:'Artist A',version:'full',bpm:90,mood:'soulful',content:'clean',preference:'approved'})};
  const b={...a,id:'b',title:'Artist B',filename:'b.mp3',catalog:catalogSchema.parse({...a.catalog,artist:'Artist B'})};
  await store.update('test','seed separated rotation',s=>{s.tracks=[a,b];s.fallback={tracks:['a','b'],anchor};s.slots=[{id:'new-show',title:'Repeated artist',start:anchor,tracks:['a']}];s.programming={enabled:true,mood:'',energy:'any',maxBpmStep:12};s.airHistory=[{key:'previous-show:0',trackId:'a',artists:['artista'],at:anchor}];});
  worker.start();await until(()=>worker.status().ready && worker.status().trackId==='b',5000);
  await delay(2200);assert.equal(worker.status().trackId,'b');
  assert.equal((await store.read()).airHistory?.at(-1)?.trackId,'b');
 }finally{worker.stop();await rm(dir,{recursive:true,force:true});}
});
