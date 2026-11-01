import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RadioProgramming } from '../client/src/components/radio/RadioProgramming';
test('programming previews before enabling and clearly reports held-out and unused music',async()=>{
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,FormData:dom.window.FormData,IS_REACT_ACT_ENVIRONMENT:true});
 const originalFetch=globalThis.fetch;const writes:any[]=[];
 globalThis.fetch=(async()=>({ok:true,json:async()=>({tracks:['a','b'],eligible:3,unused:1,minutes:6,excluded:{'Mood needs review':10},preview:[{title:'A song',artist:'Artist A',bpm:90,mood:'soul'}]})})) as any;
 const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(React.createElement(RadioProgramming,{tracks:[],canManage:true,busy:false,action:async(fn:()=>Promise<void>)=>fn(),request:async(url:string,options:RequestInit)=>{writes.push({url,options});}})));
  assert.equal(document.body.textContent!.includes('Enable reviewed rotation and artist guards'),false);
  await act(async()=>{document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,10));});
  assert.match(document.body.textContent!,/Mood needs review: 10/);assert.match(document.body.textContent!,/1 eligible tracks could not fit/);assert.equal(writes.length,0);
  const enable=[...document.querySelectorAll('button')].find(b=>b.textContent==='Enable reviewed rotation and artist guards')!;
  await act(async()=>{enable.click();await new Promise(r=>setTimeout(r,10));});assert.equal(writes[0].url,'/api/radio/programming/enable');
  assert.deepEqual(JSON.parse(writes[0].options.body as string),{mood:'',energy:'any',maxBpmStep:12});
 }finally{await act(async()=>root.unmount());dom.window.close();globalThis.fetch=originalFetch;}
});
