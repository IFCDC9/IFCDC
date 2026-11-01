import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StationStore, nowPlaying, type Station } from '../server/radio/station';
const start = Date.parse('2026-11-01T12:00:00Z');
const state: Station = { tracks: [{id:'a',title:'A',duration:10,filename:'a.mp3'},{id:'b',title:'B',duration:20,filename:'b.mp3'}],slots:[{id:'show',title:'Test',start:new Date(start).toISOString(),tracks:['a','b']}],log:[] };
test('clock selects track and seek offset, with exact boundaries and silence after show', () => {
 assert.equal(nowPlaying(state,start-1),null);
 assert.equal(nowPlaying(state,start)?.track.id,'a');
 assert.equal(nowPlaying(state,start+10000)?.track.id,'b');
 assert.equal(nowPlaying(state,start+15000)?.offset,5);
 assert.equal(nowPlaying(state,start+30000),null);
});
test('interrupted show never revives after newer show ends', () => {
 const copy = structuredClone(state); copy.slots.push({id:'new',title:'New',start:new Date(start+5000).toISOString(),tracks:['a']});
 assert.equal(nowPlaying(copy,start+6000)?.slot.id,'new');
 assert.equal(nowPlaying(copy,start+16000),null);
});
test('storage survives restart and serializes concurrent writes; failed update does not poison queue', async () => {
 const dir=await mkdtemp(path.join(os.tmpdir(),'ifcdc-radio-'));
 try {
 const store=new StationStore(dir);
 await Promise.all(Array.from({length:20},(_,i) => store.update('founder',String(i),s => {s.slots.push({...state.slots[0],id:String(i)});} )));
 await assert.rejects(store.update('founder','fail',() => {throw new Error('failure');}));
 await store.update('founder','next',() => {});
 const saved=await new StationStore(dir).read();
 assert.equal(saved.slots.length,20); assert.equal(saved.log.length,21);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('storage refuses silent ephemeral fallback', async () => {await assert.rejects(new StationStore('').read(),/RADIO_DATA_DIR/);});

test('storage rejects malformed and relative paths before creating a library', async () => {
 for(const invalid of ['\n\n/opt/render/project/src/data/radio','/tmp/radio ','relative/radio']) {
  await assert.rejects(new StationStore(invalid).read(), /absolute path/);
 }
});
test('production refuses an unmounted storage root', async () => {
 const old=process.env.NODE_ENV, root=process.env.RADIO_PERSISTENT_ROOT;
 const dir=await mkdtemp(path.join(os.tmpdir(),'radio-unmounted-'));
 try { process.env.NODE_ENV='production';process.env.RADIO_PERSISTENT_ROOT=dir;await assert.rejects(new StationStore(path.join(dir,'radio')).read(),/persistent mount/); }
 finally { if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;if(root===undefined)delete process.env.RADIO_PERSISTENT_ROOT;else process.env.RADIO_PERSISTENT_ROOT=root;await rm(dir,{recursive:true,force:true}); }
});
