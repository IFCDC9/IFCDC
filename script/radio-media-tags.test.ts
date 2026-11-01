import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inspectMp3Details } from '../server/radio/media';
test('upload reads embedded music tags without inventing absent BPM or mood',async()=>{
 const make=(tags:string[])=>{const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=duration=1','-c:a','libmp3lame',...tags,'-f','mp3','pipe:1']);assert.equal(result.status,0);return result.stdout;};
 const tagged=await inspectMp3Details(make(['-metadata','artist=Artist A','-metadata','TBPM=92','-metadata','mood=soulful','-metadata','genre=Soul']));
 assert.equal(tagged.artist,'Artist A');assert.equal(tagged.bpm,92);assert.equal(tagged.mood,'soulful');assert.equal(tagged.genre,'Soul');
 const untagged=await inspectMp3Details(make([]));assert.equal(untagged.bpm,null);assert.equal(untagged.mood,'');assert.equal(untagged.artist,'');
});
