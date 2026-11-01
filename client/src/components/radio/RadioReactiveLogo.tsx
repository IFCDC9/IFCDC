import React, { useEffect, useRef } from 'react';

type Graph = { context: AudioContext; analyser: AnalyserNode; source: MediaElementAudioSourceNode };
// StrictMode and remounts must never attach a second media source to the same player.
const graphs = new WeakMap<HTMLAudioElement, Graph>();
const left = [[284,421,436],[301,413,443],[339,413,442],[358,403,452],[379,391,463],[400,375,479],[439,421,433],[456,406,446],[476,380,473],[495,402,453],[516,380,474],[538,358,497],[561,327,486],[583,285,488]];
const bars = [...left, ...left.map(([x,t,b]) => [1253-x,t,b])];
export function RadioReactiveLogo({ audio }: { audio: React.RefObject<HTMLAudioElement | null> }) {
  const image = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const player = audio.current, img = image.current, surface = canvas.current;
    if (!player || !img || !surface) return;
    const painter = surface.getContext('2d'); if (!painter) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, disposed = false, graph: Graph | undefined;
    const levels = new Float32Array(bars.length);
    const bins = new Uint8Array(1024);
    const still = () => { cancelAnimationFrame(frame); frame=0; levels.fill(0); img.hidden=false;surface.hidden=true; };
    const tick = () => {
      frame=0;
      if(disposed || player.paused || player.ended || player.readyState<3 || document.hidden || reduced.matches || !graph || graph.context.state!=='running' || !img.naturalWidth){still();return;}
      graph.analyser.getByteFrequencyData(bins);
      const hz=graph.context.sampleRate/graph.analyser.fftSize;
      let bass=0,count=0;
      for(let k=Math.max(1,Math.ceil(35/hz));k<=Math.min(bins.length-1,Math.floor(160/hz));k++){bass+=bins[k]/255;count++;}
      bass/=count || 1;
      painter.drawImage(img,0,0,1280,1280);
      bars.forEach(([x,top,bottom],i)=>{
        const n=i%14,lo=Math.min(bins.length-1,Math.max(1,Math.floor((40*Math.pow(90,n/14))/hz)));
        const hi=Math.min(bins.length-1,Math.max(lo,Math.ceil((40*Math.pow(90,(n+1)/14))/hz)));
        let sum=0;for(let k=lo;k<=hi;k++)sum+=bins[k]/255;
        const target=Math.min(1,.7*sum/(hi-lo+1)+.5*bass);
        levels[i]+=(target-levels[i])*(target > levels[i] ? .65 : .15);
        const height=bottom-top,h=Math.max(5,height*(.08+.92*levels[i]));
        painter.fillStyle='#000';painter.fillRect(x-7,top-2,14,height+4);
        painter.drawImage(img,x-7,top-2,14,height+4,x-7,(top+bottom-h)/2,14,h);
      });
      img.hidden=true;surface.hidden=false;frame=requestAnimationFrame(tick);
    };
    const unlock = async () => {
      if(disposed || reduced.matches)return;
      try {
        graph=graphs.get(player);
        if(!graph){
          const Audio=(window as any).AudioContext || (window as any).webkitAudioContext;
          if(!Audio)return;
          const context:AudioContext=new Audio();
          const source=context.createMediaElementSource(player);
          // Sound goes directly to the output. The analyser only measures a parallel tap.
          source.connect(context.destination);
          const analyser=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.65;source.connect(analyser);
          graph={context,source,analyser};graphs.set(player,graph);
        }
        await graph.context.resume();
        if(!disposed && !frame && !player.paused)tick();
      } catch { still(); }
    };
    const start=()=>void unlock();
    const gesture=()=>{if(player.contains(document.activeElement) || !player.paused)void unlock();};
    const visibility=()=>{if(document.hidden || reduced.matches)still();else if(!player.paused)start();};
    const tune=document.getElementById('radio-studio-tune');
    tune?.addEventListener('click',start,{capture:true});
    player.addEventListener('playing',start);
    for(const event of ['pause','ended','error','waiting','stalled','emptied'])player.addEventListener(event,still);
    player.addEventListener('pointerdown',start);player.addEventListener('keydown',start);
    document.addEventListener('pointerdown',gesture);document.addEventListener('keydown',gesture);
    document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',visibility);
    img.addEventListener('load',visibility);
    if(!player.paused)start();
    return ()=>{disposed=true;still();tune?.removeEventListener('click',start,{capture:true});player.removeEventListener('playing',start);for(const event of ['pause','ended','error','waiting','stalled','emptied'])player.removeEventListener(event,still);player.removeEventListener('pointerdown',start);player.removeEventListener('keydown',start);document.removeEventListener('pointerdown',gesture);document.removeEventListener('keydown',gesture);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',visibility);img.removeEventListener('load',visibility);};
  },[audio]);
  return <><img ref={image} className="r-hero-logo" src="/ifcdc-radio-logo.webp" alt="" width="1280" height="1280"/><canvas ref={canvas} className="r-hero-logo" width="1280" height="1280" aria-hidden="true" hidden/></>;
}
