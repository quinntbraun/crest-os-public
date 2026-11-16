import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {test,vi} from 'vitest';
import {browserCsvReview} from '../../src/app/customers/import-review/csv-review-protocol';
import {findSavedLegacyMatches} from '../../src/client/legacy-contact-matches';
import {previewLegacyContacts} from '../../src/customer/legacy-contact-import-preview';
import {legacyMatchBodyLimit,legacyMatchHintLimit} from '../../src/customer/legacy-contact-match-contract';

test('saved-match calls cover all hints within count and encoded byte bounds',async()=>{
 const business='6b80945a-5a92-4328-9c6a-54593765708d';
 const phoneFor=(index:number)=>'31755'+String(index).padStart(5,'0');
 const emailFor=(index:number)=>'fictional-'+index+'-'+'🧪'.repeat(260)+'@example.test';
 const csv=new TextEncoder().encode(['Id,Name,Phone,Email,Balance',
  ...Array.from({length:1001},(_,i)=>[i,'Fictional CSV contact '+i,phoneFor(i),emailFor(i),'ignored-balance'].join(',')),
 ].join('\n'));
 const report=await previewLegacyContacts(csv,{customerSourceId:'Id',displayName:'Name',phone:'Phone',email:'Email'},business);
 const proof={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60_000};
 const submitted:{kind:'phone'|'email';hints:string[]}[]=[];
 vi.stubGlobal('fetch',vi.fn(async (path:string,init:RequestInit)=>{
  assert.equal(path,'/api/business/customers/legacy-matches');
  assert.equal(init.credentials,'same-origin');
  assert.equal(new Headers(init.headers).get('x-crest-csrf'),proof.csrfToken);
  assert.equal(typeof init.body,'string');
  const wire=String(init.body);
  assert(!wire.includes('ignored-balance')&&!wire.includes('Fictional CSV contact'));
  assert(new TextEncoder().encode(wire).byteLength<=legacyMatchBodyLimit);
  const body=JSON.parse(wire);
  assert.deepEqual(Object.keys(body),['kind','hints']);
  assert(body.hints.length<=legacyMatchHintLimit);
  submitted.push(body);
  return new Response(JSON.stringify({schemaVersion:1,businessId:business,kind:body.kind,
   counts:body.hints.map((hint:string)=>Number(hint===phoneFor(1000)||hint===emailFor(0)))}),
   {headers:{'content-type':'application/json','cache-control':'private, no-store'}});
 }));
 try{
  const matches=await findSavedLegacyMatches(browserCsvReview(report).rows,business,proof,new AbortController().signal);
  const phonePages=submitted.filter(page=>page.kind==='phone'),emailPages=submitted.filter(page=>page.kind==='email');
  assert.deepEqual(phonePages.map(page=>page.hints.length),[1000,1]);
  assert(emailPages.length>2);
  assert.deepEqual(emailPages.flatMap(page=>page.hints),Array.from({length:1001},(_,i)=>emailFor(i)));
  assert.deepEqual([...matches],[[1002,[{kind:'phone',count:1}]],[2,[{kind:'email',count:1}]]]);
 }finally{vi.unstubAllGlobals();}
});
