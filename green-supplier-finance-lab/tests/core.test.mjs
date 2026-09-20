import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario, validate, minimumBuyerShare} from '../core.js';

const row={supplier:'AAA_D01',country:'AAA',industry:'D01',direct_input_usd_m:20,producer_output_usd_m:100,
  producer_va_usd_m:40,producer_direct_ghg_t:1000,allocated_direct_ghg_t:200,allocated_va_usd_m:8};
const data={schema:1,year:2022,buyer:'BBB_D29',unmatched_count:0,
  sources:{icio:'https://www.oecd.org',emissions:'https://www.oecd.org'},links:[row]};
test('allocation and finance arithmetic agree',()=>{
  assert.equal(validate(data),data);
  assert.deepEqual(scenario(row,20,100,50),{investment:.004,buyer:.002,supplier:.002});
  assert.equal(scenario(row,20,100,0).supplier,.004);
});
test('rejects altered or unmatched data',()=>{
  assert.throws(()=>validate({...data,links:[{...row,allocated_direct_ghg_t:800}]}),/Accounting mismatch/);
  assert.throws(()=>validate({...data,links:[{...row,producer_output_usd_m:1}]}),/Accounting mismatch/);
});
test('reverse calculation solves for buyer share',()=>{
  const investment=.8;
  assert.equal(minimumBuyerShare(row,investment,5),50); // 0.4m supplier ceiling = 5% of 8m VA
  assert.equal(minimumBuyerShare(row,0,5),0);
  assert.equal(minimumBuyerShare({...row,allocated_va_usd_m:0},investment,5),100);
});
test('combined ICIO sector codes and coverage reconcile',()=>{
  const combined={...row,supplier:'AAA_C17_18',industry:'C17_18'};
  const covered={...data,links:[combined],coverage:{foreign_input_usd_m:25,matched_input_usd_m:20,
    unmatched_input_usd_m:5,input_value_share:.8,foreign_link_count:2,matched_link_count:1},unmatched_count:1};
  assert.equal(validate(covered),covered);
  assert.throws(()=>validate({...covered,coverage:{...covered.coverage,input_value_share:1}}),/coverage/);
});
