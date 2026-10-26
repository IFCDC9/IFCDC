import { Router } from 'express';
import { hqAuthRequired } from '../middleware/hqAuth';
import { engineeringApprovalAllowed } from '../hq/auraEngineeringWorkflow';
import { websiteOrigins } from '../hq/publicWebsite';
import { CreativeError, creativeStudioStatus, submitCreativeJob, refreshCreativeJob } from '../hq/creativeAssetStudio';
export function creativeAssetStudioRouter() {
  const router=Router();
  router.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});next();});
  router.use(hqAuthRequired);
  router.use((req,res,next)=>{if(!req.hqUser?.email||!engineeringApprovalAllowed(req.hqUser)||req.hqUser.email.toLowerCase()!==(process.env.MASTER_OWNER_EMAIL||'service@ifcdc.org').toLowerCase()){res.status(403).json({error:'Founder access required.'});return;}next();});
  router.use((req,res,next)=>{if(req.method==='POST'&&(!req.is('application/json')||!websiteOrigins().includes(req.get('origin')||''))){res.status(403).json({error:'Submit this request from IFCDC HQ.'});return;}next();});
  const run=(fn: any)=>(req: any,res: any)=>Promise.resolve().then(()=>fn(req,res)).catch(error=>res.status(error instanceof CreativeError?error.status:503).json({error:error instanceof CreativeError?error.message:'Creative studio is temporarily unavailable.'}));
  router.get('/',run(async(_req: any,res: any)=>res.json(await creativeStudioStatus())));
  router.post('/jobs',run(async(req: any,res: any)=>res.json(await submitCreativeJob(req.body,req.hqUser.id))));
  router.post('/jobs/:id/refresh',run(async(req: any,res: any)=>res.json(await refreshCreativeJob(req.params.id))));
  return router;
}
export default creativeAssetStudioRouter();
