import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../public/radio-listener.js',import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;const settle=()=>new Promise(r=>setTimeout(r,25));
async function setup(){
 const dom=new JSDOM(readFileSync(new URL('../public/cdc-radio.html',import.meta.url),'utf8'),{url:'https://ifcdc.org/listen'});const {window}=dom;const requests=[];let profile=null;const id='00000000-0000-4000-8000-000000000000';
 const fetch=async(url,options={})=>{requests.push({url,options});let result={};
  if(url.endsWith('/status'))result={available:true,now:{id,title:'<img src=x onerror=alert(1)>',artist:'Artist',show:'Test'},upcoming:[]};
  else if(url.endsWith('/signup')){const fields=JSON.parse(options.body);profile={id:'listener',email:fields.email,displayName:fields.displayName,avatar:'signal',genres:[],favorites:[]};result={profile};}
  else if(url.endsWith('/me')){if(options.method==='PATCH')profile={...profile,...JSON.parse(options.body)};result={profile,savedTracks:[{id,title:'Track'}]};}
  return {ok:true,status:200,json:async()=>result};
 };
 const audio=window.document.getElementById('station-audio');let paused=true;Object.defineProperty(audio,'paused',{get:()=>paused});audio.play=async()=>{paused=false;audio.dispatchEvent(new window.Event('play'));};audio.pause=()=>{paused=true;audio.dispatchEvent(new window.Event('pause'));};audio.load=()=>{};
 await new AsyncFunction('window','document','fetch','location','FormData','AbortSignal','setInterval','clearInterval',source)(window,window.document,fetch,window.location,window.FormData,AbortSignal,window.setInterval.bind(window),window.clearInterval.bind(window));await settle();return {dom,window,requests,audio,$:id=>window.document.getElementById(id)};
}
test('radio views retain one playing audio element and render program titles as text',async()=>{const ui=await setup();try{
 assert.equal(ui.$('now-title').querySelector('img'),null);assert.equal(ui.$('tune').disabled,false);ui.$('tune').click();await settle();assert.equal(ui.audio.paused,false);
 ui.window.location.hash='shows';await settle();assert.equal(ui.$('shows').hidden,false);assert.equal(ui.$('discover').hidden,true);assert.equal(ui.window.document.getElementById('station-audio'),ui.audio);assert.equal(ui.audio.paused,false);
 ui.$('tune').click();assert.equal(ui.audio.paused,true);
 }finally{ui.dom.window.close();}});
test('signup creates listener profile and saving the current track uses only profile fields',async()=>{const ui=await setup();try{
 const form=ui.$('signup-form');form.elements.displayName.value='Listener';form.elements.email.value='listener@example.test';form.elements.password.value='long-password-123';form.dispatchEvent(new ui.window.Event('submit',{cancelable:true}));await settle();
 assert.equal(ui.$('profile-account').hidden,false);assert.equal(ui.$('profile-name').textContent,'Listener');ui.$('favorite').click();await settle();
 const write=ui.requests.find(r=>r.options.method==='PATCH');assert.ok(write);assert.deepEqual(Object.keys(JSON.parse(write.options.body)).sort(),['avatar','displayName','favorites','genres']);assert.equal(JSON.parse(write.options.body).favorites.length,1);
 }finally{ui.dom.window.close();}});
