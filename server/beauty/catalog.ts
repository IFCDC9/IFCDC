import { z } from 'zod';
export const categories = ['Clippers & trimmers','Blades & accessories','Hair care','Beard & shaving','Skin & beauty','Braids & locs','Salon essentials'] as const;
export const productSchema = z.object({
  id:z.string().uuid(), name:z.string().trim().min(2).max(160), brand:z.string().trim().min(1).max(100),
  seller:z.string().trim().min(1).max(120), category:z.enum(categories),
  priceCents:z.number().int().positive().max(10000000), stock:z.number().int().nonnegative(),
  fulfillment:z.array(z.enum(['pickup','shipping'])).min(1), pickupLocation:z.string().trim().max(300).default(''),
  model:z.enum(['resale','commission']), commissionBps:z.number().int().min(0).max(10000).nullable(),
  approved:z.boolean().default(false), published:z.boolean().default(false),
}).strict().superRefine((p,c)=>{
  if(p.fulfillment.includes('pickup')&&!p.pickupLocation)c.addIssue({code:'custom',message:'Pickup requires a location.'});
  if(p.model==='commission'&&p.commissionBps===null)c.addIssue({code:'custom',message:'Agree a commission before listing.'});
  if(p.model==='resale'&&p.commissionBps!==null)c.addIssue({code:'custom',message:'Resale uses margin, not commission.'});
  if(p.published&&!p.approved)c.addIssue({code:'custom',message:'Approve supplier and resale rights before publishing.'});
});
export type BeautyProduct=z.infer<typeof productSchema>;
export function commissionCents(subtotalCents:number,bps:number){
 if(!Number.isSafeInteger(subtotalCents)||subtotalCents<0||!Number.isInteger(bps)||bps<0||bps>10000)throw new Error('Invalid commission input');
 return Math.round(subtotalCents*bps/10000);
}
