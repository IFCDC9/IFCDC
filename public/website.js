const $ = id => document.getElementById(id);
const menu = $('site-menu'); const nav = $('site-nav');
document.body.classList.add('navigation-ready');
menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', String(open)); nav.classList.toggle('is-open', open); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') { const open = menu.getAttribute('aria-expanded') === 'true'; menu.setAttribute('aria-expanded','false'); nav.classList.remove('is-open'); if (open) menu.focus(); } });
const page = document.body.dataset.page;
for (const link of nav.querySelectorAll('a')) if (link.getAttribute('href') === (page === 'home' ? '/' : `/${page}`)) link.setAttribute('aria-current','page');
if (!['ifcdc.org','www.ifcdc.org'].includes(window.location.hostname)) for (const link of document.querySelectorAll('a[href="/"]')) link.href = '/website';
async function request(path, body) {
  const response = await fetch('/api/public/website' + path,{method:body ? 'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(20000)});
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Your request could not be confirmed. Please retry the same request.'); return result;
}
const form = $('website-enquiry');
if (form) {
  const topic = new URL(window.location.href).searchParams.get('topic');
  if ([...$('enquiry-topic').options].some(option => option.value === topic)) $('enquiry-topic').value = topic;
  let attempt; try { attempt = JSON.parse(sessionStorage.getItem('ifcdc-website-enquiry-v1') || 'null'); } catch {}
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const output = $('enquiry-result'); const button = form.querySelector('button[type=submit]'); button.disabled = true; output.textContent = 'Sending your request…';
    try {
      const fields = Object.fromEntries(new FormData(form).entries()); fields.consent = form.elements.consent.checked;
      const fingerprint = JSON.stringify(fields);
      if (!attempt || attempt.fingerprint !== fingerprint) { attempt = {id:crypto.randomUUID(),fingerprint}; sessionStorage.setItem('ifcdc-website-enquiry-v1',JSON.stringify(attempt)); }
      const result = await request('/inquiries',{...fields,id:attempt.id});
      output.textContent = `${result.message}\nYour reference: ${result.id}`;
      // Keep a successful submission locked until the visitor explicitly chooses a new request.
      button.hidden = true;
      const another = document.createElement('button'); another.type='button'; another.className='button outline'; another.textContent='Start a new enquiry';
      another.addEventListener('click', () => { form.reset(); attempt=null; sessionStorage.removeItem('ifcdc-website-enquiry-v1'); button.hidden=false; another.remove(); output.textContent=''; });
      output.after(another);
    } catch(error) { output.textContent = `${error.message} You can also email service@ifcdc.org. No duplicate request is needed.`; }
    finally { button.disabled=false; }
  });
}
const streams = [...document.querySelectorAll('[data-content-section]')]; let items=[]; let filter='all';
function mediaCard(item) {
  const article=document.createElement('article'); article.className='media-card';
  if (item.kind==='photo') {
    const image=document.createElement('img'); image.src=item.url; image.alt=item.title; image.loading='lazy'; image.decoding='async'; image.referrerPolicy='no-referrer';
    image.addEventListener('error',()=>{ image.remove(); }); article.append(image);
  }
  if (item.kind==='video') {
    const stage=document.createElement('div'); stage.className='video-stage'; const play=document.createElement('button'); play.type='button'; play.textContent='▷ Play video'; play.setAttribute('aria-label',`Play ${item.title}`);
    play.addEventListener('click',()=>{const frame=document.createElement('iframe'); frame.src=item.url; frame.title=item.title; frame.loading='lazy'; frame.referrerPolicy='no-referrer'; frame.allow='fullscreen; picture-in-picture'; frame.allowFullscreen=true; frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation'); stage.replaceChildren(frame);}); stage.append(play); article.append(stage);
  }
  const copy=document.createElement('div'); copy.className='media-copy'; const section=document.createElement('p'); section.className='eyebrow'; section.textContent=item.section.toUpperCase();
  const title=document.createElement('h3'); title.textContent=item.title; const desc=document.createElement('p'); desc.textContent=item.description; copy.append(section,title,desc);
  if(item.kind==='link') {const link=document.createElement('a'); link.href=item.url; link.textContent='Explore this work ↗'; link.target='_blank'; link.rel='noopener noreferrer'; copy.append(link);}
  article.append(copy); return article;
}
function renderMedia() {
  for(const stream of streams){const section=stream.dataset.contentSection; const matches=items.filter(item=>(section==='all'||item.section===section)&&(filter==='all'||item.section===filter)); stream.replaceChildren(...matches.slice(0,page==='home'?3:60).map(mediaCard)); stream.hidden=!matches.length;}
  for(const fallback of document.querySelectorAll('.media-fallback')) fallback.hidden=items.some(item=>filter==='all'||item.section===filter);
}
for(const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click',()=>{filter=button.dataset.filter; for(const other of document.querySelectorAll('[data-filter]'))other.setAttribute('aria-pressed',String(other===button));renderMedia();});
if(streams.length) try {const data=await request('/content'); items=data.items || []; renderMedia();} catch {for(const fallback of document.querySelectorAll('.media-fallback')) fallback.hidden=false;}
