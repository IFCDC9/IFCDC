import test from 'node:test';
import assert from 'node:assert/strict';
import {founderOnlyReadIsBlocked} from './grant-center-qa.mjs';

test('Grant QA requires the actual Founder-only denial instead of legacy board read access',()=>{
 assert.equal(founderOnlyReadIsBlocked({res:{status:403},body:{code:'hq_founder_only'}}),true);
 for(const response of [
  {res:{status:200},body:{platform:[]}},
  {res:{status:401},body:{error:'Authentication required'}},
  {res:{status:403},body:{error:'Insufficient permissions'}},
  {res:{status:503},body:{code:'hq_founder_only'}},
  null,
 ])assert.equal(founderOnlyReadIsBlocked(response),false);
});
