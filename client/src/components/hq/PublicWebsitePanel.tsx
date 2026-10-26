import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hqApiFetch } from '../../api/hqApiFetch';
type Item = { id?: string; kind: string; section: string; title: string; description: string; url: string; published: number | boolean };
type Message = { id: string; name: string; email: string; topic: string; message: string; created_at: number; notification: string };
type Data = { items: Item[]; messages: Message[]; notificationsConfigured: boolean };
const blank: Item = { kind:'photo', section:'community', title:'', description:'', url:'', published:false };
const fieldStyle: React.CSSProperties = { display:'block', width:'100%', padding:10, margin:'6px 0 14px', background:'var(--hq-bg)', color:'var(--hq-text)', border:'1px solid #777', borderRadius:6 };
export default function PublicWebsitePanel() {
  const query = useQuery({queryKey:['ifcdc-public-website'],queryFn:()=>hqApiFetch<Data>('/api/public/website/admin'),retry:false});
  const [item,setItem] = useState<Item>({...blank}); const [message,setMessage] = useState(''); const [busy,setBusy] = useState(false);
  const update = (field: keyof Item, value: string | boolean) => setItem(previous=>({...previous,[field]:value}));
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await hqApiFetch('/api/public/website/content',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,published:!!item.published})}); setMessage(item.published ? 'Published to the public website.' : 'Draft saved. It is not visible to visitors.'); setItem({...blank}); await query.refetch(); }
    catch(error) {setMessage(error instanceof Error ? error.message : 'Could not save content.');} finally {setBusy(false);}
  }
  async function upload(file?: File) {
    if (!file) return; if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024) {setMessage('Choose a JPEG, PNG, or WebP photo up to 5 MB.');return;}
    setBusy(true); setMessage('Uploading image…');
    try {const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=reject; reader.readAsDataURL(file);});
      const result=await hqApiFetch<{url:string}>('/api/public/website/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})}); setItem(previous=>({...previous,kind:'photo',url:result.url}));setMessage('Image uploaded. Add a descriptive title, then save your draft or publish.');
    } catch(error) {setMessage(error instanceof Error ? error.message : 'Upload failed.');} finally{setBusy(false);}
  }
  if (query.isError) return null;
  return <section className="hq-panel" style={{padding:'1.25rem',marginBottom:20}}>
    <h2>Public website manager</h2><p><a href="/website" target="_blank" rel="noreferrer">Preview the CDC website ↗</a> · <a href="https://ifcdc.org" target="_blank" rel="noreferrer">ifcdc.org ↗</a> · <button type="button" className="hq-btn hq-btn-secondary" onClick={()=>void query.refetch()}>Refresh</button></p>
    <p>Publish IFCDC photos, YouTube/Vimeo videos, and external links. Published items appear immediately on Media and the relevant division section. Draft entries stay off public pages. Uploaded photos are accessible to anyone with their image link. Only publish material you have permission to share.</p>
    <form onSubmit={save} style={{maxWidth:700}}>
      <h3>{item.id ? 'Edit website content' : 'Add website content'}</h3>
      <label>Content type<select style={fieldStyle} value={item.kind} onChange={event=>update('kind',event.target.value)}><option value="photo">Photo</option><option value="video">YouTube / Vimeo video</option><option value="link">External link</option></select></label>
      <label>Division<select style={fieldStyle} value={item.section} onChange={event=>update('section',event.target.value)}>{['community','software','music','film','publishing','radio'].map(section=><option key={section}>{section}</option>)}</select></label>
      <label>Title / photo description<input style={fieldStyle} value={item.title} required minLength={3} maxLength={120} onChange={event=>update('title',event.target.value)}/></label>
      <label>Description<textarea style={fieldStyle} value={item.description} maxLength={800} rows={3} onChange={event=>update('description',event.target.value)}/></label>
      <label>Photo, video, or destination URL<input style={fieldStyle} value={item.url} required maxLength={2000} onChange={event=>update('url',event.target.value)}/></label>
      <label>Or upload a photo (JPEG, PNG, WebP, up to 5 MB)<input style={fieldStyle} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>void upload(event.target.files?.[0])}/></label>
      <label style={{display:'block',marginBottom:15}}><input type="checkbox" checked={!!item.published} onChange={event=>update('published',event.target.checked)}/> Publish this item publicly when I save</label>
      <button type="submit" className="hq-btn hq-btn-primary" disabled={busy}>{busy ? 'Working…' : item.published ? 'Save & publish' : 'Save draft'}</button>{item.id && <button type="button" className="hq-btn hq-btn-secondary" onClick={()=>setItem({...blank})}>Cancel edit</button>}
      <p role="status" style={{whiteSpace:'pre-wrap'}}>{message}</p>
    </form>
    <h3>Website content</h3>{!query.data ? <p>Loading…</p> : <>{!query.data.items.length && <p>No media published yet. Add your first photo, video, or link above.</p>}{query.data.items.map(entry=><p key={entry.id}><strong>{entry.title}</strong> · {entry.section} · {entry.published ? 'Published':'Draft'} <button className="hq-btn hq-btn-secondary" type="button" onClick={()=>{setItem({...entry});setMessage('Editing this item. Uncheck Publish and save to remove it from public display.');}}>Edit / unpublish</button></p>)}
    <h3>Website enquiries &amp; careers interest</h3><p>Business email notifications: {query.data.notificationsConfigured ? 'Postmark configured — check each delivery status below':'Postmark not configured — enquiries still save in HQ'}. Replies are managed by IFCDC through its business mailbox.</p>
    {!query.data.messages.length && <p>No website enquiries yet.</p>}{query.data.messages.map(entry=><article key={entry.id} style={{borderTop:'1px solid #555',padding:'15px 0',overflowWrap:'anywhere'}}><strong>{entry.topic} — {entry.name}</strong><p>{entry.email} · {new Date(entry.created_at).toLocaleString()} · Notification: {entry.notification}</p><p style={{whiteSpace:'pre-wrap'}}>{entry.message}</p><small>{entry.id}</small></article>)}</>}
  </section>;
}
