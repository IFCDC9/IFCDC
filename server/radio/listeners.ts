import { randomBytes, randomUUID, createHash, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { getDb } from '../db';
const scrypt=promisify(derive);
export const profileSchema=z.object({displayName:z.string().trim().min(2).max(60),avatar:z.enum(['signal','vinyl','headphones','star']).default('signal'),genres:z.array(z.string().trim().min(1).max(40)).max(8).default([]),favorites:z.array(z.string().uuid()).max(100).default([])}).strict();
export const signupSchema=profileSchema.pick({displayName:true}).extend({email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(12).max(128)}).strict();
export const loginSchema=signupSchema.omit({displayName:true});
export class ListenerError extends Error {constructor(public status:number,message:string){super(message);}}
let initializing:Promise<any>|undefined;
async function db(){
 if(!initializing)initializing=(async()=>{const d=await getDb();await d.exec(`CREATE TABLE IF NOT EXISTS radio_listeners (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,profile TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS radio_listener_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS radio_listener_sessions_user ON radio_listener_sessions(user_id);`);return d;})().catch(e=>{initializing=undefined;throw e;});
 return initializing;
}
async function passwordHash(password:string,salt=randomBytes(16).toString('hex')) {return `${salt}:${(await scrypt(password,salt,64) as Buffer).toString('hex')}`;}
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const profile=(row:any)=>({id:row.id,email:row.email,...JSON.parse(row.profile)});
async function session(id:string){const d=await db();const token=randomBytes(32).toString('hex');const now=Date.now();await d.run('DELETE FROM radio_listener_sessions WHERE expires_at < ?',now);await d.run('INSERT INTO radio_listener_sessions VALUES (?,?,?,?)',digest(token),id,now+7*86400000,now);await d.run('DELETE FROM radio_listener_sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM radio_listener_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 5)',id,id);return token;}
export async function createListener(input:z.infer<typeof signupSchema>){
 const d=await db();if((await d.get('SELECT count(*) AS count FROM radio_listeners')).count>=10000)throw new ListenerError(503,'Listener registration is temporarily full.');
 const id=randomUUID();const hash=await passwordHash(input.password);const result=await d.run('INSERT OR IGNORE INTO radio_listeners VALUES (?,?,?,?,?)',id,input.email,hash,JSON.stringify(profileSchema.parse({displayName:input.displayName})),Date.now());
 if(!result.changes)throw new ListenerError(409,'Unable to create that account. Try signing in or contact service@ifcdc.org.');
 return {token:await session(id),profile:profile(await d.get('SELECT * FROM radio_listeners WHERE id=?',id))};
}
export async function loginListener(input:z.infer<typeof loginSchema>){
 const row=await(await db()).get('SELECT * FROM radio_listeners WHERE email=?',input.email);
 const [salt,expected]=(row?.password_hash || '00000000000000000000000000000000:'+ '0'.repeat(128)).split(':');
 const actual=await passwordHash(input.password,salt);
 if(!timingSafeEqual(Buffer.from(actual.split(':')[1],'hex'),Buffer.from(expected,'hex'))||!row)throw new ListenerError(401,'Email or password is incorrect.');
 return {token:await session(row.id),profile:profile(row)};
}
export async function getListener(token:string){
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const row=await(await db()).get('SELECT l.* FROM radio_listeners l JOIN radio_listener_sessions s ON s.user_id=l.id WHERE s.token_hash=? AND s.expires_at>?',digest(token),Date.now());
 return row ? profile(row) : null;
}
export async function saveListener(id:string,value:z.infer<typeof profileSchema>){await(await db()).run('UPDATE radio_listeners SET profile=? WHERE id=?',JSON.stringify(value),id);}
export async function logoutListener(token:string){await(await db()).run('DELETE FROM radio_listener_sessions WHERE token_hash=?',digest(token));}
export async function deleteListener(id:string){const d=await db();await d.run('DELETE FROM radio_listener_sessions WHERE user_id=?',id);await d.run('DELETE FROM radio_listeners WHERE id=?',id);}
