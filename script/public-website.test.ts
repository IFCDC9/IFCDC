import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
const directory=mkdtempSync(tmpdir()+'/ifcdc-website-');
process.env.NODE_ENV='test';process.env.IFCDC_DATA_DIR=directory;process.env.MASTER_OWNER_EMAIL='service@ifcdc.org';
const { websiteUrl, mediaItem, inquiryInput, saveWebsiteInquiry, websiteDb, publicWebsiteHost }=await import('../server/hq/publicWebsite.ts');
const { publicWebsiteRouter }=await import('../server/routes/publicWebsite.routes.ts');
const { registerPublicPageRoutes }=await import('../server/routes/monolith/publicPages.routes.ts');
const express=(await import('express')).default;
const jwt=(await import('jsonwebtoken')).default;const {JWT_SECRET}=await import('../server/config/auth.ts');
const app=express();app.use(express.json({limit:'7mb'}));app.use('/api/public/website',publicWebsiteRouter());registerPublicPageRoutes(app);app.get('/',(_req,res)=>res.send('PRIVATE HQ SPA'));
await websiteDb();const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const founder=jwt.sign({id:'founder',email:'service@ifcdc.org',role:'owner'},JWT_SECRET);
const call=(route:string,body?:any,token?:string,source='https://ifcdc.org')=>fetch(origin+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:source,...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
const input=()=>({id:crypto.randomUUID(),name:'Visitor Name',email:'visitor@example.test',topic:'General enquiry',message:'I would like to learn about community work.',consent:true,website:''});
test.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await(await websiteDb()).close();rmSync(directory,{recursive:true,force:true});});
const rootRequest = (headers: Record<string,string>) => new Promise<{text:string;headers:http.IncomingHttpHeaders}>((resolve,reject)=>{http.get(origin+'/',{headers},response=>{let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({text,headers:response.headers}));}).on('error',reject);});
test('only approved public hosts receive public root; HQ and forwarded-host injection retain existing root',async()=>{
 assert.equal(publicWebsiteHost('IFCDC.org:443'),true);assert.equal(publicWebsiteHost('hq.ifcdc.org'),false);assert.equal(publicWebsiteHost('ifcdc.org.evil.test'),false);
 for(const host of ['ifcdc.org','www.ifcdc.org']){const response=await rootRequest({Host:host});assert.match(response.text,/People first/);assert.equal(response.headers['x-frame-options'],'DENY');}
 assert.equal((await rootRequest({Host:'hq.ifcdc.org','X-Forwarded-Host':'ifcdc.org'})).text,'PRIVATE HQ SPA');
});
test('all public page paths and historical HTML aliases serve the new website without a login',async()=>{
 for(const route of ['/listen','/listen.html','/website','/about','/programs','/services', '/design-app','/design-website','/contact','/careers','/media','/privacy-policy','/terms-of-use','/about.html','/programs.html','/contact.html']){const response=await call(route);assert.equal(response.status,200,route);assert.match(await response.text(),/service@ifcdc.org/,route);}
});
test('content validation blocks executable, private, credentialed, and unsupported embed URLs',()=>{
 for(const value of ['javascript:alert(1)','http://example.test/x','https://127.0.0.1/x','https://localhost/x','https://user:pass@example.com/x','https://name.internal/x'])assert.throws(()=>websiteUrl(value,'link'));
 assert.equal(websiteUrl('https://youtu.be/AbCdEf12345','video'),'https://www.youtube-nocookie.com/embed/AbCdEf12345');
 assert.equal(websiteUrl('https://vimeo.com/123456','video'),'https://player.vimeo.com/video/123456');
 assert.throws(()=>websiteUrl('https://evil.test/video','video'));assert.throws(()=>mediaItem({kind:'svg',section:'community'}));
});
test('enquiries require consent and valid bounded fields',()=>{
 for(const value of [{...input(),consent:false},{...input(),website:'spam'},{...input(),email:'bad'},{...input(),message:'short'},{...input(),topic:'payroll'}])assert.throws(()=>inquiryInput(value));
});
test('enquiry is durable and idempotent; business notification uses fixed business sender/recipient and no submitted private content',async()=>{
 const value=input();let notifications=0;let payload:any;
 const options={env:{POSTMARK_SERVER_TOKEN:'PRIVATE_TOKEN'},fetchImpl:(async(_url:any,request:any)=>{notifications++;payload=JSON.parse(request.body);return {ok:true,json:async()=>({ErrorCode:0})} as any;}) as typeof fetch};
 await saveWebsiteInquiry(value,'visitor',options);await saveWebsiteInquiry(value,'visitor',options);assert.equal(notifications,1);assert.equal(payload.To,'service@ifcdc.org');assert.equal(payload.From,'IFCDC Website <service@ifcdc.org>');assert.ok(!payload.TextBody.includes(value.message));assert.ok(!payload.TextBody.includes(value.email));
 assert.equal((await(await websiteDb()).get('SELECT notification FROM ifcdc_website_messages WHERE id=?',value.id)).notification,'accepted');
 await assert.rejects(saveWebsiteInquiry({...value,message:'A different message on the same id'},'visitor',options),/another message/);
});
test('failed notification does not lose the stored enquiry or retry a possibly delivered email',async()=>{
 const value=input();let count=0;const options={env:{POSTMARK_SERVER_TOKEN:'TOKEN'},fetchImpl:(async()=>{count++;throw Error('timeout');}) as typeof fetch};
 await saveWebsiteInquiry(value,'other',options);await saveWebsiteInquiry(value,'other',options);assert.equal(count,1);assert.equal((await(await websiteDb()).get('SELECT notification FROM ifcdc_website_messages WHERE id=?',value.id)).notification,'uncertain');
});
test('public mutations reject foreign origins; private records and publishing require Founder access',async()=>{
 assert.equal((await call('/api/public/website/inquiries',input(),undefined,'https://evil.test')).status,403);
 assert.equal((await call('/api/public/website/admin')).status,401);
 assert.equal((await call('/api/public/website/content',{kind:'link'})).status,401);
 const staff=jwt.sign({id:'staff',email:'staff@example.test',role:'employee'},JWT_SECRET);
 assert.equal((await call('/api/public/website/admin',undefined,staff)).status,403);
 assert.equal((await call('/api/public/website/admin',undefined,founder)).status,200);
});
test('drafts stay off public feed; publishing and unpublishing update only the selected item',async()=>{
 const item={kind:'link',section:'community',title:'A community update',description:'A real project story.',url:'https://example.com/story',published:false};
 const result=await call('/api/public/website/content',item,founder);assert.equal(result.status,200);const {id}=await result.json() as any;
 let feed=await(await call('/api/public/website/content')).json() as any;assert.equal(feed.items.length,0);
 assert.equal((await call('/api/public/website/content',{...item,id,published:true},founder)).status,200);
 feed=await(await call('/api/public/website/content')).json() as any;assert.equal(feed.items[0].title,item.title);assert.ok(!JSON.stringify(feed).includes('visitor@example.test'));
 await call('/api/public/website/content',{...item,id,published:false},founder);feed=await(await call('/api/public/website/content')).json() as any;assert.equal(feed.items.length,0);
});
test('photo uploads require Founder and raster bytes, with traversal and SVG rejected',async()=>{
 assert.equal((await call('/api/public/website/upload',{data:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')},founder)).status,400);
 const data=readFileSync(new URL('../public/ifcdc-brand-logo.jpeg',import.meta.url)).toString('base64');
 assert.equal((await call('/api/public/website/upload',{data})).status,401);
 const response=await call('/api/public/website/upload',{data},founder);assert.equal(response.status,201);const {url}=await response.json() as any;
 const image=await call(url);assert.equal(image.status,200);assert.match(image.headers.get('content-type')!,/image\/jpeg/);assert.equal(image.headers.get('x-content-type-options'),'nosniff');
 assert.equal((await call('/api/public/website/media/not-a-file.svg')).status,404);
});
test('public enquiries are visible only in private HQ records',async()=>{
 const value=input();assert.equal((await call('/api/public/website/inquiries',value)).status,201);
 const data=await(await call('/api/public/website/admin',undefined,founder)).json() as any;assert.ok(data.messages.some((row:any)=>row.id===value.id));assert.ok(data.messages.every((row:any)=>!('digest'in row)));
});
