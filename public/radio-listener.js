const $=id=>document.getElementById(id);
const audio=$('station-audio');let profile=null;let station=null;let savedTracks=[];let available=false;
const avatars={signal:'◉',vinyl:'◎',headphones:'♫',star:'✧'};
function error(message){$('radio-error').textContent=message;$('radio-error').hidden=!message;}
async function api(path,body,method=body?'POST':'GET'){
 const response=await fetch('/api/public/radio'+path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Radio-Client':'website'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 if(response.status===204)return {};
 const result=await response.json();if(!response.ok)throw new Error(result.error || 'The station could not complete that request.');return result;
}
function view(){
 const selected=['discover','shows','profile'].includes(location.hash.slice(1))?location.hash.slice(1):'discover';
 for(const name of ['discover','shows','profile']){$(name).hidden=name!==selected;$('tab-'+name).setAttribute('aria-selected',String(name===selected));$('tab-'+name).tabIndex=name===selected?0:-1;}
}
window.addEventListener('hashchange',view);view();
const tabs=[...document.querySelectorAll('[role=tab]')];
for(const [index,tab] of tabs.entries())tab.addEventListener('keydown',e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();});
function playing(value){document.body.classList.toggle('r-playing',value);$('tune').textContent=value?'Ⅱ Disconnect':'▶ Tune in';}
audio.addEventListener('play',()=>playing(true));audio.addEventListener('pause',()=>playing(false));audio.addEventListener('ended',()=>playing(false));audio.addEventListener('error',()=>{playing(false);error('The stream disconnected. Press Tune in to reconnect.');});
$('tune').addEventListener('click',async()=>{
 if(!audio.paused){audio.pause();audio.removeAttribute('src');audio.load();return;}
 try{error('');audio.src='/api/public/radio/stream';await audio.play();}catch{error('The stream is unavailable. Press Tune in to try again.');}
});
$('popout').addEventListener('click',()=>{audio.pause();audio.removeAttribute('src');audio.load();const tab=window.open('/listen#discover','ifcdc-radio-player','popup,width=1000,height=820');if(!tab)error('Allow pop-ups for IFCDC to open the listening window.');});
function renderProfile(){
 $('profile-intro').hidden=!!profile;$('profile-account').hidden=!profile;
 $('profile-nav').textContent=profile?profile.displayName:'Your profile';
 if(!profile)return;
 $('profile-name').textContent=profile.displayName;$('profile-avatar').textContent=avatars[profile.avatar]||'◉';
 const form=$('profile-form');form.elements.displayName.value=profile.displayName;form.elements.avatar.value=profile.avatar;form.elements.genres.value=profile.genres.join(', ');
 const list=$('saved-list');list.replaceChildren();
 if(!profile.favorites.length){const p=document.createElement('p');p.textContent='Save a track while it plays to build your collection.';list.append(p);}
 for(const id of profile.favorites){const row=document.createElement('div');row.className='r-row';const label=document.createElement('span');label.textContent=savedTracks.find(t=>t.id===id)?.title || (station?.now?.id===id?station.now.title:'Saved track unavailable');const remove=document.createElement('button');remove.textContent='Remove';remove.className='r-ghost';remove.addEventListener('click',()=>mutate(remove,async()=>{await saveProfile({...profile,favorites:profile.favorites.filter(x=>x!==id)});}));row.append(label,remove);list.append(row);}
}
async function me(){const result=await api('/me');profile=result.profile;savedTracks=result.savedTracks || [];renderProfile();}
async function saveProfile(value){const {displayName,avatar,genres,favorites}=value;const result=await api('/me',{displayName,avatar,genres,favorites},'PATCH');profile=result.profile;await me();renderFavorite();}
async function mutate(button,fn){button.disabled=true;error('');try{await fn();}catch(e){error(e.message);}finally{button.disabled=false;}}
for(const mode of ['signup','login']){const form=$(mode+'-form');form.addEventListener('submit',e=>{e.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('button');void mutate(button,async()=>{const result=await api('/'+mode,Object.fromEntries(new FormData(form)));profile=result.profile;form.reset();await me();renderFavorite();$('radio-message').textContent=mode==='signup'?'Your listener profile is ready.':'Welcome back.';});});}
$('profile-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;void mutate(form.querySelector('button'),async()=>{await saveProfile({...profile,displayName:form.elements.displayName.value,avatar:form.elements.avatar.value,genres:[...new Set(form.elements.genres.value.split(',').map(x=>x.trim()).filter(Boolean))]});$('radio-message').textContent='Your preferences are saved.';});});
$('logout').addEventListener('click',()=>mutate($('logout'),async()=>{await api('/logout',{},'POST');profile=null;savedTracks=[];renderProfile();renderFavorite();}));
$('delete-account').addEventListener('click',()=>{if(!window.confirm('Delete your listener profile, preferences and saved tracks? This cannot be undone.'))return;void mutate($('delete-account'),async()=>{await api('/me',null,'DELETE');profile=null;savedTracks=[];renderProfile();renderFavorite();$('radio-message').textContent='Your listener account has been deleted.';});});
function renderFavorite(){const button=$('favorite');button.hidden=!station?.now?.id;button.textContent=profile?.favorites.includes(station?.now?.id)?'♥ Saved track':'♡ Save track';}
$('favorite').addEventListener('click',()=>{if(!profile){location.hash='profile';$('radio-message').textContent='Create a listener profile or sign in to save tracks.';return;}const id=station?.now?.id;if(!id)return;void mutate($('favorite'),()=>saveProfile({...profile,favorites:profile.favorites.includes(id)?profile.favorites.filter(x=>x!==id):[...profile.favorites,id]}));});
async function refresh(){
 const result=await api('/status');station=result;available=!!result.available;
 $('tune').disabled=!available;$('signal-status').dataset.ready=String(available);$('signal-status').textContent=available?'Station connected':'Station preparing';
 $('now-title').textContent=result.now?.title || 'Your next listening moment';$('now-subtitle').textContent=result.now ? [result.now.artist,result.now.show].filter(Boolean).join(' · ') : result.message;
 if(available && !audio.src)audio.src='/api/public/radio/stream';
 const list=$('show-list');list.replaceChildren();
 for(const show of result.upcoming || []){const row=document.createElement('div');row.className='r-row';const title=document.createElement('strong');title.textContent=show.title;const start=document.createElement('time');start.dateTime=show.start;start.textContent=new Date(show.start).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'});row.append(title,start);list.append(row);}
 if(!list.childNodes.length){const p=document.createElement('p');p.textContent='The next show listings will appear here when scheduled.';list.append(p);}
 renderFavorite();
}
me().catch(()=>error('Your profile could not be loaded. Please try signing in again.'));
refresh().catch(()=>error('The station could not be reached. We will keep checking.'));
const timer=setInterval(()=>refresh().catch(()=>{$('signal-status').textContent='Reconnecting';$('signal-status').dataset.ready='false';$('tune').disabled=true;}),10000);
window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
