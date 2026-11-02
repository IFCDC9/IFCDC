import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productSchema, commissionCents } from '../server/beauty/catalog';
const product={id:'00000000-0000-4000-8000-000000000001',name:'Test tool',brand:'Test',seller:'Example',category:'Clippers & trimmers',priceCents:10000,stock:1,fulfillment:['shipping'],model:'resale',commissionBps:null,approved:false,published:false};
test('unapproved suppliers cannot publish',()=>assert.equal(productSchema.safeParse({...product,published:true}).success,false));
test('pickup requires a real pickup location',()=>assert.equal(productSchema.safeParse({...product,fulfillment:['pickup']}).success,false));
test('commission must be agreed, not defaulted',()=>{assert.equal(productSchema.safeParse({...product,model:'commission'}).success,false);assert.equal(productSchema.safeParse({...product,model:'commission',commissionBps:1500}).success,true);});
test('approved products validate and inventory cannot go negative',()=>{assert.equal(productSchema.safeParse({...product,approved:true,published:true}).success,true);assert.equal(productSchema.safeParse({...product,stock:-1}).success,false);});
test('commission calculation uses integer cents and validates inputs',()=>{assert.equal(commissionCents(9999,1500),1500);assert.equal(commissionCents(10000,0),0);assert.throws(()=>commissionCents(-1,2000));assert.throws(()=>commissionCents(100,10001));});
