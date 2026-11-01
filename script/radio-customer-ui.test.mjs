import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = readFileSync(new URL('../public/radio-customer.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
async function setup({signedIn=true}={}) {
  const dom = new JSDOM(readFileSync(new URL('../public/cdc-radio-studio.html', import.meta.url), 'utf8'), {url:'https://ifcdc.org/radio-studio'});
  const w = dom.window; const calls=[]; const id='00000000-0000-4000-8000-000000000001'; const trackId='00000000-0000-4000-8000-000000000002';
  let exists=false;
  const state={station:{id,name:'My station',description:'My sound',hasLogo:false,broadcasting:false},tracks:[],crates:[],slots:[],usedBytes:0,limits:{tracks:100,storageBytes:250*1048576}};
  const fetch=async(url,options={})=>{
    calls.push({url,options});let result={};let status=200;
    if(!signedIn)return {status:401,ok:false,json:async()=>({error:'Sign in first.'})};
    const suffix=url.replace('/api/public/radio/stations',''); const body=typeof options.body==='string'?JSON.parse(options.body):options.body;
    if(!suffix && options.method==='GET')result={enabled:true,stations:exists?[state.station]:[]};
    else if(!suffix && options.method==='POST'){exists=true;state.station.name=body.name;result={station:state.station};}
    else if(suffix==='/' + id && options.method==='GET')result=state;
    else if(suffix.includes('/library?')){state.tracks=[{id:trackId,title:'<img src=x onerror=alert(1)>',duration:10}];result={id:trackId,duplicate:false};}
    else if(suffix.endsWith('/crates')){state.crates.push({id:'crate',name:body.name,tracks:body.tracks});}
    else if(suffix.endsWith('/schedule')){state.slots.push({id:'slot',...body});}
    return {ok:status<400,status,json:async()=>result};
  };
  await new AsyncFunction('document','fetch','FormData','Blob','AbortSignal','confirm',source)(w.document,fetch,w.FormData,w.Blob,AbortSignal,()=>true);await settle();
  return {dom,w,calls,state,$:id=>w.document.getElementById(id)};
}
test('signed-out customer sees account entry instead of workspace controls',async()=>{const ui=await setup({signedIn:false});try{assert.equal(ui.$('signin').hidden,false);assert.equal(ui.$('workspace').hidden,true);assert.equal(ui.$('create').hidden,true);}finally{ui.dom.window.close();}});
test('customer creates draft, uploads permitted music, selects all, saves own crate and future draft show',async()=>{
  const ui=await setup();try{
    const form=ui.$('create-form');form.elements.name.value='My station';form.dispatchEvent(new ui.w.Event('submit',{cancelable:true}));await settle();
    assert.equal(ui.$('workspace').hidden,false);assert.match(ui.$('workspace-message').textContent,/No subscription/);
    const input=ui.$('music-files');const file=new ui.w.File(['music'],'tone.mp3',{type:'audio/mpeg'});Object.defineProperty(input,'files',{value:[file],configurable:true});
    input.dispatchEvent(new ui.w.Event('change'));await settle();assert.match(ui.$('workspace-error').textContent,/permission/);assert.equal(ui.calls.some(c=>c.url.includes('/library?')),false);
    ui.$('upload-rights').checked=true;input.dispatchEvent(new ui.w.Event('change'));await settle();
    assert.equal(ui.$('track-list').querySelector('img'),null);assert.match(ui.$('upload-progress').textContent,/1 added/);
    assert.equal(ui.calls.find(c=>c.url.includes('/library?')).options.headers['X-Radio-Upload-Rights'],'confirmed');
    ui.$('select-all').click();assert.match(ui.$('selection-count').textContent,/1 selected/);
    const crate=ui.$('crate-form');crate.elements.name.value='Soul crate';crate.dispatchEvent(new ui.w.Event('submit',{cancelable:true}));await settle();assert.equal(ui.state.crates.length,1);
    const schedule=ui.$('schedule-form');schedule.elements.title.value='Night sound';schedule.elements.start.value='2099-10-31T20:00';schedule.dispatchEvent(new ui.w.Event('submit',{cancelable:true}));await settle();assert.equal(ui.state.slots.length,1);assert.match(ui.$('workspace-message').textContent,/not broadcasting/);
    assert.ok(!ui.calls.some(c=>c.url.includes('paypal') || c.url.includes('/stream')));
  }finally{ui.dom.window.close();}
});
