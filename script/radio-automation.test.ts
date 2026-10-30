import test from 'node:test';
import assert from 'node:assert/strict';
import { occurrence, recurrenceSchema, type RecurringShow } from '../server/radio/automation';
import { nowPlaying, selectPlayback, type Station } from '../server/radio/station';
import { catalogSchema } from '../server/radio/catalog';
const stamp=(s:string)=>Date.parse(s);
const show:RecurringShow={id:'daily',title:'Morning',startDate:'2026-01-01',time:'09:00',timezone:'America/New_York',weekdays:[0,1,2,3,4,5,6],tracks:['a'],createdAt:'2026-01-01T00:00:00Z'};
const base=():Station=>({tracks:[{id:'a',filename:'a.mp3',title:'A',duration:600,catalog:catalogSchema.parse({content:'clean',preference:'approved'})}],slots:[],log:[],recurring:[show]});
test('daily local clock handles DST, nonexistent and repeated hours explicitly',()=>{
 assert.equal(occurrence('2026-03-07','09:00','America/New_York'),stamp('2026-03-07T14:00:00Z'));
 assert.equal(occurrence('2026-03-08','09:00','America/New_York'),stamp('2026-03-08T13:00:00Z'));
 assert.equal(occurrence('2026-03-08','02:30','America/New_York'),null);
 assert.equal(occurrence('2026-11-01','01:30','America/New_York'),stamp('2026-11-01T05:30:00Z'));
 assert.equal(nowPlaying(base(),stamp('2026-03-08T13:05:00Z'))?.offset,300);
});
test('weekly recurrence, creation boundary, one-off priority and no interrupted-show revival',()=>{
 const s=base();s.recurring=[{...show,weekdays:[1]}];
 assert.ok(nowPlaying(s,stamp('2026-03-09T13:05:00Z')));
 assert.equal(nowPlaying(s,stamp('2026-03-10T13:05:00Z')),null);
 s.recurring=[{...show,createdAt:'2026-03-09T13:01:00Z'}];assert.equal(nowPlaying(s,stamp('2026-03-09T13:05:00Z')),null);
 s.recurring=[show];s.slots=[{id:'manual',title:'Override',start:'2026-03-09T13:00:00Z',tracks:['a']}];
 assert.equal(nowPlaying(s,stamp('2026-03-09T13:00:01Z'))?.slot.id,'manual');
 s.tracks.push({id:'short',title:'Short',filename:'b.mp3',duration:60});
 s.slots=[{id:'override',title:'Override',start:'2026-03-09T13:02:00Z',tracks:['short']}];
 assert.equal(nowPlaying(s,stamp('2026-03-09T13:03:01Z')),null);
});
test('fallback uses persistent clock, excludes unapproved/rejected and blocked tracks, yields to shows',()=>{
 const s=base();s.recurring=[];s.tracks[0].duration=10;
 s.tracks.push({id:'b',title:'B',filename:'b.mp3',duration:20,catalog:catalogSchema.parse({content:'clean',preference:'favorite'})});
 const anchor='2026-10-30T12:00:00Z';s.fallback={tracks:['a','b'],anchor};
 const t=stamp(anchor)+15000;assert.equal(selectPlayback(s,t)?.track.id,'b');assert.equal(selectPlayback(s,t)?.offset,5);assert.equal(selectPlayback(s,t)?.mode,'fallback');
 assert.equal(selectPlayback(s,stamp(anchor)+35000)?.offset,5);
 assert.notEqual(selectPlayback(s,stamp(anchor)+5000)?.slot.id,selectPlayback(s,stamp(anchor)+35000)?.slot.id);
 s.slots=[{id:'show',title:'Show',start:anchor,tracks:['a']}];assert.equal(selectPlayback(s,stamp(anchor)+5000)?.mode,'scheduled');
 assert.equal(selectPlayback(s,stamp(anchor)+5000,new Set(['a']))?.track.id,'b');
 s.tracks[1].catalog!.preference='rejected';assert.equal(selectPlayback(s,t,new Set(['a'])),null);
});
test('invalid timezone, date, weekday and clock are rejected',()=>{
 const input={title:show.title,startDate:show.startDate,time:show.time,timezone:show.timezone,weekdays:show.weekdays,tracks:['00000000-0000-4000-8000-000000000000']};
 for(const patch of [{timezone:'Mars/Radio'},{startDate:'2026-02-30'},{time:'25:00'},{weekdays:[]},{weekdays:[8]}]) assert.equal(recurrenceSchema.safeParse({...input,...patch}).success,false);
});
