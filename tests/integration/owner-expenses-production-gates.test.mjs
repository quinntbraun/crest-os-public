// No production account, credential, network call or validator is supplied.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReceiptHttp} from '../../src/bookkeeping/expenses/receipt-http.ts';
test('test dispatcher construction cannot become a production receipt route',()=>{
 const config={connectionString:'postgresql://synthetic:synthetic@invalid.example/never',environment:'production',origin:'https://crest.example',ingress:{kind:'direct'},businessId:'11111111-1111-1111-1111-111111111111'};
 assert.throws(()=>createReceiptHttp(config,undefined,undefined,{},async()=>{},true),error=>error.message==='EXPENSE_REVIEW_REQUIRED');
});
