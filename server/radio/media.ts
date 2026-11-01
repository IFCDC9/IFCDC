import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const run=promisify(execFile);
export async function inspectMp3Details(audio:Buffer) {
 const dir=await mkdtemp(path.join(os.tmpdir(),'ifcdc-radio-probe-'));
 try {
  const file=path.join(dir,'upload.mp3');await writeFile(file,audio,{mode:0o600});
  const binary=process.env.RADIO_FFPROBE_PATH || (process.env.RADIO_FFMPEG_PATH ? path.join(path.dirname(process.env.RADIO_FFMPEG_PATH),'ffprobe') : 'ffprobe');
  const {stdout}=await run(binary,['-v','error','-show_entries','format=duration:format_tags:stream=codec_name,codec_type','-of','json',file],{timeout:10000,maxBuffer:65536});
  const data=JSON.parse(stdout);const duration=Number(data.format?.duration);
  if(!Number.isFinite(duration)||duration<=0||duration>86400||!data.streams?.some((s:any)=>s.codec_type==='audio'&&s.codec_name==='mp3')) throw new Error('Not a supported MP3');
  const tags=Object.fromEntries(Object.entries(data.format?.tags || {}).map(([key,value])=>[key.toLowerCase(),String(value).trim().slice(0,100)]));
  const bpm=Number(tags.tbpm || tags.bpm);
  return {duration,artist:tags.artist || '',genre:tags.genre || '',mood:tags.mood || '',bpm:Number.isFinite(bpm)&&bpm>=20&&bpm<=300?bpm:null};
 } catch(error:any) {
  if(error.code==='ENOENT')throw new Error('FFprobe is unavailable. Configure RADIO_FFPROBE_PATH to validate uploads.');
  throw Object.assign(new Error('Unable to verify MP3 audio. Choose a valid MP3 recording.'),{status:400});
 } finally {await rm(dir,{recursive:true,force:true});}
}

export async function inspectMp3(audio:Buffer){return (await inspectMp3Details(audio)).duration;}
