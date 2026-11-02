import { Router } from 'express';
import { getDb } from '../db';
import { categories, productSchema } from '../beauty/catalog';
import { hqAuthRequired } from '../middleware/hqAuth';
const router=Router();
async function database(){const db=await getDb();await db.exec('CREATE TABLE IF NOT EXISTS beauty_products (id TEXT PRIMARY KEY, document TEXT NOT NULL, updated_at INTEGER NOT NULL)');return db;}
router.use((_q,s,n)=>{s.set('Cache-Control','no-store');n();});
router.get('/catalog',async(_q,s)=>{try{const db=await database();const rows=await db.all('SELECT document FROM beauty_products ORDER BY updated_at DESC');const products=rows.map(r=>productSchema.parse(JSON.parse(r.document))).filter(p=>p.approved&&p.published);s.json({categories,products,checkoutEnabled:false});}catch{s.status(503).json({error:'The catalog is temporarily unavailable.'});}});
router.get('/manage',hqAuthRequired,async(q,s)=>{if(!['owner','founder'].includes(q.user?.role||''))return s.status(403).json({error:'Founder access required.'});try{const db=await database();s.json({products:(await db.all('SELECT document FROM beauty_products ORDER BY updated_at DESC')).map(r=>JSON.parse(r.document))});}catch{s.status(503).json({error:'Catalog storage unavailable.'});}});
router.put('/manage',hqAuthRequired,async(q,s)=>{
 if(!['owner','founder'].includes(q.user?.role||''))return s.status(403).json({error:'Founder access required.'});
 const origin=q.get('origin');if(origin&&origin!==`${q.protocol}://${q.get('host')}`)return s.status(403).json({error:'Use the same site to manage products.'});
 const parsed=productSchema.safeParse(q.body);if(!parsed.success)return s.status(400).json({error:parsed.error.flatten()});
 try{const db=await database();await db.run('INSERT INTO beauty_products(id,document,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,updated_at=excluded.updated_at',parsed.data.id,JSON.stringify(parsed.data),Date.now());s.json({product:parsed.data});}catch{s.status(503).json({error:'Product could not be saved.'});}
});
export default router;
