import React, { useRef, useState } from 'react';

export function RadioUpload({disabled,upload,refresh}:{disabled:boolean;upload:(file:File)=>Promise<void>;refresh:()=>Promise<void>}) {
 const [running,setRunning]=useState(false);
 const [progress,setProgress]=useState('');
 const [failures,setFailures]=useState<string[]>([]);
 const stop=useRef(false);
 const lock=useRef(false);
 async function importFiles(files:File[]) {
  if(lock.current || !files.length)return;
  lock.current=true;stop.current=false;setRunning(true);setFailures([]);
  let imported=0,skipped=0,failed=0,processed=0;
  const errors:string[]=[];
  const report=()=>setProgress(`${processed} of ${files.length} checked · ${imported} imported · ${skipped} skipped · ${failed} failed`);
  report();
  try {
   for(const file of files){
    if(stop.current)break;
    const name=file.webkitRelativePath || file.name;
    setProgress(`Importing ${processed+1} of ${files.length}: ${name}`);
    if(!/\.mp3$/i.test(file.name) || file.name.startsWith('._')){skipped++;}
    else if(file.size===0 || file.size>25*1024*1024){failed++;errors.push(`${name}: ${file.size===0?'Empty file':'Exceeds 25 MB'}`);}
    else {try{await upload(file);imported++;}catch(e){failed++;errors.push(`${name}: ${e instanceof Error?e.message:'Upload failed'}`);}}
    processed++;report();
   }
   try{await refresh();}catch{errors.push('Refresh the library to see the latest uploads.');}
  } finally {
   setFailures(errors);setProgress(`${stop.current?'Stopped':'Finished'}: ${imported} imported · ${skipped} skipped · ${failed} failed · ${files.length-processed} remaining`);
   lock.current=false;setRunning(false);
  }
 }
 const choose=(e:React.ChangeEvent<HTMLInputElement>)=>{const files=Array.from(e.target.files || []);e.target.value='';void importFiles(files);};
 return <section aria-label="Import music" className="r-card">
  <h3>Import your music</h3><p>Select a music folder, including its subfolders, or choose multiple MP3 files. Each MP3 can be up to 25 MB. Files upload one at a time; keep this tab open until the batch finishes.</p>
  <div className="r-grid">
   <label>Add MP3 files<input type="file" multiple accept="audio/mpeg,.mp3" disabled={disabled || running} onChange={choose}/></label>
   <label>Add entire music folder<input type="file" multiple ref={node=>{if(node)node.setAttribute('webkitdirectory','');}} disabled={disabled || running} onChange={choose}/></label>
  </div>
  <p className="r-small">Other formats are skipped. Reimporting a folder can create duplicate tracks. Folder structure is not saved as crates. If folder selection is unavailable on your device, use Add MP3 files.</p>
  {running && <button type="button" className="r-ghost" onClick={()=>{stop.current=true;setProgress('Stopping after the current file…');}}>Stop after current file</button>}
  <p role="status" aria-live="polite">{progress}</p>
  {failures.length>0 && <details><summary>Review import issues ({failures.length})</summary><ul>{failures.map((message,i)=><li key={i}>{message}</li>)}</ul></details>}
 </section>;
}
