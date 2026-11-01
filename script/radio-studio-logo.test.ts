import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RadioReactiveLogo } from '../client/src/components/radio/RadioReactiveLogo';
test('studio logo measures actual player frequencies, preserves direct sound and stops while paused',async()=>{
 const dom=new JSDOM('<button id="radio-studio-tune">Tune in</button><audio></audio><div id="root"></div>',{pretendToBeVisual:true});const w=dom.window;
 let frames=0,draws=0,sources=0;const connections:any[]=[];
 Object.assign(globalThis,{window:w,document:w.document,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:()=>++frames,cancelAnimationFrame:()=>{}});
 Object.defineProperty(w.HTMLCanvasElement.prototype,'getContext',{value:()=>({drawImage:()=>draws++,fillRect:()=>{},fillStyle:''})});
 w.matchMedia=(()=>({matches:false,addEventListener(){},removeEventListener(){}})) as any;
 class Audio {state='running';sampleRate=48000;destination={output:true};async resume(){}createMediaElementSource(){sources++;return {connect:(destination:any)=>connections.push(destination)};}createAnalyser(){return {fftSize:2048,smoothingTimeConstant:0,getByteFrequencyData:(bins:Uint8Array)=>bins.fill(200)};}}
 (w as any).AudioContext=Audio;
 const player=w.document.querySelector('audio')!;let paused=true;Object.defineProperty(player,'paused',{get:()=>paused});Object.defineProperty(player,'readyState',{get:()=>4});
 const root=createRoot(w.document.getElementById('root')!);const audio={current:player};
 await act(async()=>root.render(React.createElement(RadioReactiveLogo,{audio})));
 const img=w.document.querySelector('img')!;Object.defineProperty(img,'naturalWidth',{value:1280});
 w.document.getElementById('radio-studio-tune')!.click();await new Promise(r=>setTimeout(r,0));assert.equal(sources,1);assert.deepEqual(connections[0],{output:true});
 paused=false;player.dispatchEvent(new w.Event('playing'));await new Promise(r=>setTimeout(r,0));
 assert.ok(draws>1);assert.equal(w.document.querySelector('canvas')!.hidden,false);assert.equal(img.hidden,true);
 paused=true;player.dispatchEvent(new w.Event('pause'));assert.equal(w.document.querySelector('canvas')!.hidden,true);assert.equal(img.hidden,false);
 paused=false;player.dispatchEvent(new w.Event('playing'));await new Promise(r=>setTimeout(r,0));assert.equal(sources,1);
 await act(async()=>root.unmount());dom.window.close();
});
