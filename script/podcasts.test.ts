import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
test('podcasts isolate creators, keep drafts private and publish supported media links',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'podcasts-'));process.env.IFCDC_DATA_DIR=dir;process.env.NODE_ENV='test';
 const {createListener,deleteListener}=await import('../server/radio/listeners');const {podcastRouter}=await import('../server/routes/podcasts');
 const alice=await createListener({displayName:'Alice',email:'alice@podcast.test',password:'long-test-password'});const bob=await createListener({displayName:'Bob',email:'bob@podcast.test',password:'long-test-password'});
 const app=express();app.use(cookieParser());app.use(podcastRouter({origins:()=>['https://ifcdc.org']}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const call=(url='',method='GET',body?:any,token=alice.token,origin='https://ifcdc.org')=>fetch(base+url,{method,headers:{Cookie:`ifcdc_radio_listener=${token}`,Origin:origin,'X-Radio-Client':'website','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
 assert.equal((await call('/mine','GET',undefined,'')).status,401);
 assert.equal((await call('','POST',{title:'Series',description:'',category:'Culture'},alice.token,'https://evil.test')).status,403);
 const created=await call('','POST',{title:'Series',description:'Conversations',category:'Culture'});assert.equal(created.status,201);const {id}=await created.json();
 await assert.rejects(()=>deleteListener(alice.profile.id),/podcast series/);
 const episode={title:'First episode',description:'Story',format:'audio',url:'https://example.org/episode.mp3',published:false,rights:true};
 assert.equal((await call('/'+id+'/episodes','POST',episode,bob.token)).status,404);
 assert.equal((await call('/'+id+'/episodes','POST',{...episode,url:'javascript:alert(1)'})).status,400);
 const added=await call('/'+id+'/episodes','POST',episode);assert.equal(added.status,201);const eid=(await added.json()).id;
 assert.equal((await (await call()).json()).shows.length,0);assert.equal((await call('/'+id)).status,404);
 assert.equal((await (await call('/mine','GET',undefined,bob.token)).json()).episodes.length,0);
 assert.equal((await call('/'+id+'/episodes/'+eid,'PATCH',{...episode,published:true})).status,204);
 const publicShows=await(await call()).json();assert.equal(publicShows.shows.length,1);assert.equal(publicShows.shows[0].owner_id,undefined);
 assert.equal((await(await call('/'+id)).json()).episodes.length,1);
 assert.equal((await call('/'+id,'DELETE',undefined,bob.token)).status,404);
 assert.equal((await call('/'+id,'DELETE')).status,204);assert.equal((await(await call('/mine')).json()).episodes.length,0);
 await deleteListener(alice.profile.id);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
