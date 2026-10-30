import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { StationStore } from '../radio/station';
import type { RadioPlayout } from '../radio/playout';
import { recurringSlots } from '../radio/automation';
import { websiteOrigins, websiteLimit } from '../hq/publicWebsite';
import { createListener, loginListener, getListener, saveListener, logoutListener, deleteListener, signupSchema, loginSchema, profileSchema, ListenerError } from '../radio/listeners';
const COOKIE='ifcdc_radio_listener';
export function publicRadioRouter(store:StationStore,playout:RadioPlayout,options:{enabled?:()=>boolean;origins?:()=>string[]}={}){
 const router=Router();const enabled=options.enabled || (()=>process.env.RADIO_PUBLIC_ENABLED==='true');
 const reads=new Map<string,{count:number;until:number}>();
 router.use((req,res,next)=>{const key=req.ip || 'unknown';const now=Date.now();let limit=reads.get(key);if(!limit || limit.until<now){if(reads.size>=5000)reads.delete(reads.keys().next().value!);limit={count:0,until:now+60000};reads.set(key,limit);}if(++limit.count>120)return res.status(429).json({error:'Too many radio requests. Please wait a minute.'});next();});
 const wrap=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{fn(req,res).catch(next);};
 router.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});next();});
 router.get('/status',wrap(async(_req,res)=>{
  if(!enabled())return res.json({available:false,now:null,upcoming:[],message:'Public listening is being prepared.'});
  const s=await store.read();const status=playout.status();
  const actual=s.tracks.find(t=>t.id===status.trackId);
  const track=actual ? {id:actual.id,title:actual.title,artist:actual.catalog?.artist || '',show:status.showTitle,mode:status.mode} : null;
  const future=[...s.slots];for(let day=1;day<=8;day++)future.push(...recurringSlots(s.recurring || [],Date.now()+day*86400000));
  const unique=[...new Map(future.map(x=>[x.id,x])).values()];
  res.json({available:status.ready,now:track,upcoming:unique.filter(x=>Date.parse(x.start)>Date.now()).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(0,6).map(x=>({id:x.id,title:x.title,start:x.start})),message:status.ready ? (track ? 'Station stream available' : 'Between shows — the stream is carrying silence.') : 'The station is reconnecting.'});
 }));
 router.get('/stream',(req,res)=>{if(!enabled())return res.status(503).json({error:'Public listening is not enabled yet.'});playout.listen(res);});
 router.get('/me',wrap(async(req,res)=>{const user=await getListener(req.cookies?.[COOKIE] || '');const state=user ? await store.read():null;res.json({profile:user,savedTracks:state?.tracks.filter(t=>user!.favorites.includes(t.id)).map(t=>({id:t.id,title:t.title})) || []});}));
 router.use((req,res,next)=>{
  if(!enabled() && ['/signup','/login'].includes(req.path))return res.status(503).json({error:'Listener registration opens with public radio.'});
  if(!(options.origins || websiteOrigins)().includes(req.get('origin') || '') || req.get('x-radio-client')!=='website')return res.status(403).json({error:'Use the IFCDC Radio website to update your listener account.'});
  next();
 });
 router.use(express.json({limit:'8kb'}));
 const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict' as const,path:'/api/public/radio',maxAge:7*86400000};
 for(const mode of ['signup','login'] as const) router.post('/'+mode,wrap(async(req,res)=>{
  await websiteLimit(req.ip || 'unknown','radio-auth',15);
  const result=mode==='signup' ? await createListener(signupSchema.parse(req.body)) : await loginListener(loginSchema.parse(req.body));
  res.cookie(COOKIE,result.token,cookieOptions);res.status(mode==='signup'?201:200).json({profile:result.profile});
 }));
 router.post('/logout',wrap(async(req,res)=>{await logoutListener(req.cookies?.[COOKIE] || '');res.clearCookie(COOKIE,{...cookieOptions,maxAge:undefined});res.sendStatus(204);}));
 router.patch('/me',wrap(async(req,res)=>{
  const user=await getListener(req.cookies?.[COOKIE] || '');if(!user)throw new ListenerError(401,'Sign in to edit your listener profile.');
  const value=profileSchema.parse(req.body);if(value.favorites.some(id=>!user.favorites.includes(id)&&id!==playout.status().trackId))throw new ListenerError(400,'Save a track while it is playing on the station.');await saveListener(user.id,value);res.json({profile:{id:user.id,email:user.email,...value}});
 }));
 router.delete('/me',wrap(async(req,res)=>{const user=await getListener(req.cookies?.[COOKIE] || '');if(!user)throw new ListenerError(401,'Sign in first.');await deleteListener(user.id);res.clearCookie(COOKIE,{...cookieOptions,maxAge:undefined});res.sendStatus(204);}));
 router.use((error:any,_req:Request,res:Response,_next:NextFunction)=>{const status=error instanceof z.ZodError?400:error instanceof ListenerError?error.status:error.status===429?429:error.type==='entity.too.large'?413:503;res.status(status).json({error:error instanceof z.ZodError?'Check the form fields. Passwords need 12–128 characters.':status===503?'Radio services are temporarily unavailable.':error.message});});
 return router;
}
