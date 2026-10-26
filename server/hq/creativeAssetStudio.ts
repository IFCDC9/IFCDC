import crypto from 'node:crypto';
import { getDb } from '../db';
import { requestRunwayCreative, runwayApiKeyPresence } from './runwayVideoProvider';
export class CreativeError extends Error { constructor(public status: number, message: string) { super(message); } }
export const creativeModels = { image:{model:'gen4_image',credits:8,ratio:'1920:1080'}, video:{model:'gen4.5',credits:24,ratio:'1280:720',duration:2} } as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function creativeConfig() {
  const raw=Number(process.env.IFCDC_RUNWAY_DAILY_CREDITS || 100);
  const validLimit=Number.isInteger(raw)&&raw>0&&raw<=1000;
  return { credentialPresent:runwayApiKeyPresence()==='PRESENT', enabled:process.env.IFCDC_RUNWAY_STUDIO_ENABLED==='true'&&validLimit, dailyCreditLimit:validLimit?raw:0, models:creativeModels };
}
async function dbReady() {
  const db=await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS ifcdc_creative_jobs (id TEXT PRIMARY KEY, digest TEXT NOT NULL, actor_id TEXT NOT NULL, project_id TEXT, kind TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT NOT NULL, reserved_credits INTEGER NOT NULL, budget_day TEXT NOT NULL, state TEXT NOT NULL, task_id TEXT, output_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, last_poll INTEGER NOT NULL DEFAULT 0, provider_http INTEGER, note TEXT);
    CREATE INDEX IF NOT EXISTS idx_creative_budget_day ON ifcdc_creative_jobs(budget_day);`);
  return db;
}
export function creativeInput(input: any) {
  if(!input||!uuid.test(input.id)||!['image','video'].includes(input.kind)||input.confirmed!==true)throw new CreativeError(400,'Choose an output and explicitly confirm its credit reservation.');
  const kind=input.kind as keyof typeof creativeModels;const model=creativeModels[kind];
  const prompt=typeof input.prompt==='string'?input.prompt.trim():'';
  const projectId=input.projectId || null;
  if(prompt.length<10||prompt.length>1000||input.confirmCredits!==model.credits||(projectId!==null&&(typeof projectId!=='string'||!uuid.test(projectId))))throw new CreativeError(400,'Check the prompt (10–1,000 characters), project reference, and credit confirmation.');
  return {id:input.id,kind,prompt,projectId,model};
}
function view(row: any) {return {id:row.id,projectId:row.project_id,kind:row.kind,prompt:row.prompt,model:row.model,reservedCredits:row.reserved_credits,state:row.state,taskId:row.task_id,outputs:JSON.parse(row.output_json),createdAt:row.created_at,lastPoll:row.last_poll,note:row.note};}
export async function creativeStudioStatus() {
  const db=await dbReady();const day=new Date().toISOString().slice(0,10);
  const budget=await db.get('SELECT COALESCE(SUM(reserved_credits),0) AS reserved FROM ifcdc_creative_jobs WHERE budget_day=?',day);
  return {...creativeConfig(),budgetDay:day,reservedToday:budget.reserved,jobs:(await db.all('SELECT * FROM ifcdc_creative_jobs ORDER BY created_at DESC LIMIT 30')).map(view)};
}
export async function submitCreativeJob(input: any, actorId: string, fetchImpl: typeof fetch = fetch) {
  const value=creativeInput(input);const db=await dbReady();
  const digest=crypto.createHash('sha256').update(JSON.stringify({kind:value.kind,prompt:value.prompt,projectId:value.projectId})).digest('hex');
  const existing=await db.get('SELECT * FROM ifcdc_creative_jobs WHERE id=?',value.id);
  if(existing){if(existing.digest!==digest)throw new CreativeError(409,'This request ID belongs to a different concept. Start a new job.');return view(existing);}
  const cfg=creativeConfig();if(!cfg.enabled||!cfg.credentialPresent)throw new CreativeError(503,'Runway studio needs its private credential and enable setting on Render.');
  if(value.projectId){const record=await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='ifcdc_website_messages'");if(!record||!await db.get('SELECT id FROM ifcdc_website_messages WHERE id=?',value.projectId))throw new CreativeError(400,'Website project reference was not found.');}
  const day=new Date().toISOString().slice(0,10);
  // One atomic statement reserves credits before any provider call, including concurrent requests.
  const reservation=await db.run(`INSERT OR IGNORE INTO ifcdc_creative_jobs (id,digest,actor_id,project_id,kind,prompt,model,reserved_credits,budget_day,state,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(reserved_credits),0) FROM ifcdc_creative_jobs WHERE budget_day=?) + ? <= ?`,value.id,digest,actorId,value.projectId,value.kind,value.prompt,value.model.model,value.model.credits,day,'SUBMITTING',Date.now(),day,value.model.credits,cfg.dailyCreditLimit);
  if(!reservation.changes){const row=await db.get('SELECT * FROM ifcdc_creative_jobs WHERE id=?',value.id);if(row&&row.digest===digest)return view(row);if(row)throw new CreativeError(409,'Request ID already in use.');throw new CreativeError(429,'Daily Runway credit reservation limit reached.');}
  try {
    const response=await requestRunwayCreative(value.kind==='image'?'/text_to_image':'/text_to_video',{model:value.model.model,promptText:value.prompt,ratio:value.model.ratio,...(value.kind==='video'?{duration:2}:{})},fetchImpl);
    const data=response.data as {id?: unknown}|null;
    if(response.ok&&typeof data?.id==='string'&&uuid.test(data.id))await db.run("UPDATE ifcdc_creative_jobs SET state='PENDING',task_id=?,provider_http=? WHERE id=?",data.id,response.status,value.id);
    else await db.run('UPDATE ifcdc_creative_jobs SET state=?,provider_http=?,note=? WHERE id=?',response.ok?'UNCERTAIN':'REJECTED',response.status,response.ok?'Provider task was not confirmed. Check Runway before starting another job.':`Runway rejected the request (HTTP ${response.status}). Review credentials, credits, or model availability in Runway.`,value.id);
  } catch {await db.run("UPDATE ifcdc_creative_jobs SET state='UNCERTAIN',note=? WHERE id=?",'Provider outcome unknown. This job will not be resubmitted automatically. Check Runway before starting another job.',value.id);}
  return view(await db.get('SELECT * FROM ifcdc_creative_jobs WHERE id=?',value.id));
}
function safeOutput(value: unknown) {
  if(typeof value!=='string'||value.length>8192)return false;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)&&!/(?:^|\.)(localhost|internal|local)$/i.test(url.hostname);}catch{return false;}
}
export async function refreshCreativeJob(id: string, fetchImpl: typeof fetch = fetch) {
  if(!uuid.test(id))throw new CreativeError(400,'Invalid job reference.');
  const db=await dbReady();let row=await db.get('SELECT * FROM ifcdc_creative_jobs WHERE id=?',id);
  if(!row)throw new CreativeError(404,'Job not found.');
  if(!row.task_id||!['PENDING','RUNNING','THROTTLED'].includes(row.state))return view(row);
  if(!creativeConfig().credentialPresent)throw new CreativeError(503,'Runway credential missing.');
  // Polling is explicitly requested and never more frequent than every five seconds per task.
  const claim=await db.run('UPDATE ifcdc_creative_jobs SET last_poll=? WHERE id=? AND last_poll<=?',Date.now(),id,Date.now()-5000);
  if(!claim.changes)return view(row);
  try{
    const response=await requestRunwayCreative('/tasks/'+row.task_id,undefined,fetchImpl);
    const data=response.data as {status?:unknown;output?:unknown}|null;
    if(!response.ok)throw new Error('Provider unavailable');
    const state=typeof data?.status==='string'&&['PENDING','RUNNING','THROTTLED','SUCCEEDED','FAILED','CANCELED','CANCELLED'].includes(data.status)?data.status:'PENDING';
    const outputs=Array.isArray(data?.output)?data.output.filter(safeOutput).slice(0,4):[];
    await db.run('UPDATE ifcdc_creative_jobs SET state=?,output_json=?,note=NULL WHERE id=?',state,JSON.stringify(outputs),id);
  }catch{await db.run('UPDATE ifcdc_creative_jobs SET note=? WHERE id=?','Status could not be refreshed. Retry later; a refresh never starts another generation.',id);}
  return view(await db.get('SELECT * FROM ifcdc_creative_jobs WHERE id=?',id));
}
