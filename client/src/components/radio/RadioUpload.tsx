import React, { useRef, useState } from 'react';

export function RadioUpload({disabled,upload,refresh}:{disabled:boolean;upload:(file:File)=>Promise<boolean|void>;refresh:()=>Promise<void>}) {
 const [running,setRunning]=useState(false);
 const [progress,setProgress]=useState('');
 const [batchBytes,setBatchBytes]=useState(0);
 const [storage,setStorage]=useState<{tracks:number;limit:number;freeBytes:number;reserveBytes:number}|null>(null);
 const [failures,setFailures]=useState<string[]>([]);
 const stop=useRef(false);
 const lock=useRef(false);
 async function importFiles(files:File[]) {
  if(lock.current || !files.length)return;
  setBatchBytes(files.filter(file=>/\.mp3$/i.test(file.name) && !file.name.startsWith('._')).reduce((sum,file)=>sum+file.size,0));
  lock.current=true;stop.current=false;setRunning(true);setFailures([]);
  let imported=0,skipped=0,failed=0,processed=0;
  const errors:string[]=[];
  const report=()=>setProgress(`${processed} of ${files.length} checked · ${imported} imported · ${skipped} skipped · ${failed} failed`);
  report();
  try {
   const response=await fetch('/api/radio/storage',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(15000)});
   const data=await response.json();if(!response.ok)throw new Error(data.error || 'Unable to verify radio storage.');setStorage(data);
   if(data.freeBytes<=data.reserveBytes)throw new Error('Radio disk is nearly full. Increase disk capacity before importing.');
   for(const file of files){
    if(stop.current)break;
    const name=file.webkitRelativePath || file.name;
    setProgress(`Importing ${processed+1} of ${files.length}: ${name}`);
    if(!/\.mp3$/i.test(file.name) || file.name.startsWith('._')){skipped++;}
    else if(file.size===0 || file.size>25*1024*1024){failed++;errors.push(`${name}: ${file.size===0?'Empty file':'Exceeds 25 MB'}`);}
    else {try{if(await upload(file))skipped++;else imported++;}catch(e){failed++;errors.push(`${name}: ${e instanceof Error?e.message:'Upload failed'}`);setFailures([...errors]);if([401,403,429,503,507].includes((e as any)?.status))stop.current=true;}}
    processed++;report();if(processed%25===0)await refresh().catch(()=>{});
   }
   try{await refresh();}catch{errors.push('Refresh the library to see the latest uploads.');}
  } catch(e){errors.push(e instanceof Error?e.message:'Import stopped');stop.current=true;} finally {
   setFailures(errors);setProgress(`${stop.current?'Stopped':'Finished'}: ${imported} imported · ${skipped} skipped · ${failed} failed · ${files.length-processed} remaining`);
   lock.current=false;setRunning(false);
  }
 }
 const choose=(e:React.ChangeEvent<HTMLInputElement>)=>{const files=Array.from(e.target.files || []);e.target.value='';void importFiles(files);};
 return <section aria-label="Import music" className="r-card">
  <h3>Import your music</h3>{storage && <p role="status">Before this batch: server library {storage.tracks} / {storage.limit} tracks · free disk {(storage.freeBytes/1073741824).toFixed(2)} GB · reserve {(storage.reserveBytes/1048576).toFixed(0)} MB · selected MP3s {(batchBytes/1073741824).toFixed(2)} GB before duplicate skipping{batchBytes>storage.freeBytes-storage.reserveBytes?' — batch may exceed available disk space':''}</p>}<p>Select a music folder, including its subfolders, or choose multiple MP3 files. Each MP3 can be up to 25 MB. Files upload one at a time; keep this tab open until the batch finishes.</p>
  <div className="r-grid">
   <label>Add MP3 files<input type="file" multiple accept="audio/mpeg,.mp3" disabled={disabled || running} onChange={choose}/></label>
   <label>Add entire music folder<input type="file" multiple ref={node=>{if(node)node.setAttribute('webkitdirectory','');}} disabled={disabled || running} onChange={choose}/></label>
  </div>
  <p className="r-small">Other formats are skipped. Identical audio is skipped on reimport; older uploads are matched by title and audio bytes. Folder structure is not saved as crates. If folder selection is unavailable on your device, use Add MP3 files.</p>
  {running && <button type="button" className="r-ghost" onClick={()=>{stop.current=true;setProgress('Stopping after the current file…');}}>Stop after current file</button>}
  <p role="status" aria-live="polite">{progress}</p>
  {failures.length>0 && <details open><summary>Review import issues ({failures.length})</summary><ul>{failures.map((message,i)=><li key={i}>{message}</li>)}</ul></details>}
 </section>;
}
