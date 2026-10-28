import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {calculateQuote} from '../../src/commercial/quote-pricing.ts';

const sql=await readFile(new URL('../../planning/proposals/quote-pricing.sql',import.meta.url),'utf8');
const provenance=JSON.parse(await readFile(new URL('../../planning/proposals/quote-pricing.json',import.meta.url),'utf8'));
let sandbox,client,base44;
const line=(grossCents,patch={})=>({id:randomUUID(),grossCents,lineDiscount:null,documentDiscountEligible:true,complimentaryReason:null,...patch});
const calculate=async(lines,discount=null)=>(await client.query('SELECT crest_private.calculate_quote_pricing($1::jsonb,$2::jsonb) AS value',[JSON.stringify(lines),JSON.stringify(discount)])).rows[0].value;
const matching=async(lines,discount=null)=>{const expected=calculateQuote(lines,discount);assert.deepEqual(await calculate(lines,discount),expected);return expected;};
before(async()=>{
 assert.equal(provenance.registered,false);assert.equal(provenance.runtimeEnabled,false);assert.equal(provenance.existingMigrationCount,44);
 assert.equal(Buffer.byteLength(sql),provenance.sqlBytes);assert.equal(createHash('sha256').update(sql).digest('hex'),provenance.sqlSha256);
 sandbox=await migrationSandbox();const target=await sandbox.database();client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);base44=await sandbox.prefix(44);await sandbox.apply(target,base44);
 await client.query('BEGIN');try{await client.query(sql);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
},{timeout:240000});
after(async()=>{await sandbox?.close();});

test('unregistered arithmetic helpers stay closed to every runtime role and add no business tables',async()=>{
 for(const name of ['quote_discount_cents(jsonb,numeric)','calculate_quote_pricing(jsonb,jsonb)']){
  const definition=(await client.query("SELECT p.proowner='crest_schema_owner'::regrole AS owner,NOT p.prosecdef AS invoker,p.provolatile='i' AS immutable,p.proconfig FROM pg_proc p WHERE oid=$1::regprocedure",['crest_private.'+name])).rows[0];
  assert.equal(definition.owner,true);assert.equal(definition.invoker,true);assert.equal(definition.immutable,true);assert.deepEqual(definition.proconfig,['search_path=pg_catalog, pg_temp']);
  for(const role of ['crest_web','crest_worker','crest_export'])assert.equal((await client.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS permitted',[role,'crest_private.'+name])).rows[0].permitted,false);
  assert.equal((await client.query("SELECT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS permitted",['crest_private.'+name])).rows[0].permitted,false);
 }
 for(const table of ['quote_families','quote_revisions','quote_items'])assert.equal((await client.query('SELECT to_regclass($1) AS relation',['crest.'+table])).rows[0].relation,null);
});
test('matches BR04 two-vehicle52500-cent allocations and stable-order29003-cent fixture',async()=>{
 const first=await matching([line('25000'),line('30000')],{kind:'fixed',cents:'2500'});assert.deepEqual(first.lines.map(row=>row.allocatedDiscountCents),['1136','1364']);
 const tied=[line('10001'),line('10001'),line('10001')];assert.equal((await matching(tied,{kind:'fixed',cents:'1000'})).totalCents,'29003');
 const reordered=[tied[2],tied[0],tied[1]];assert.equal((await matching(reordered,{kind:'fixed',cents:'1000'})).lines[0].id,reordered[0].id);
});
test('uses sequential percentage discounts and exact positive half-up rounding',async()=>{
 assert.equal((await matching([line('10000',{lineDiscount:{kind:'percent',rate:'0.1'}})],{kind:'percent',rate:'0.1'})).totalCents,'8100');
 const rounded=await matching([line('1',{lineDiscount:{kind:'percent',rate:'0.5'},complimentaryReason:'Synthetic rounding'})]);assert.equal(rounded.lines[0].lineDiscountCents,'1');
 await matching([line('100000001')],{kind:'percent',rate:'0.00000001'});
});
test('keeps zero-weight and excluded lines out of allocation, including an empty eligible subtotal',async()=>{
 await matching([line('0',{complimentaryReason:'Synthetic goodwill'}),line('10000'),line('5000',{documentDiscountEligible:false})],{kind:'percent',rate:'0.25'});
 await matching([line('0',{complimentaryReason:'Synthetic goodwill'})],{kind:'percent',rate:'1'});
 await matching([line('10000',{documentDiscountEligible:false})],{kind:'fixed',cents:'0'});
});
test('retains integer cents and quotient remainders at the bigint boundary without rounded division',async()=>{
 await matching([line('9007199254740993')],{kind:'fixed',cents:'1'});
 const rows=[line('9223372036854775806',{complimentaryReason:'Synthetic allocation'}),line('1',{complimentaryReason:'Synthetic allocation'})];
 for(const amount of ['1','4611686018427387903','9223372036854775806','9223372036854775807'])await matching(rows,{kind:'fixed',cents:amount});
});
test('matches the independent application calculator across64 varied allocation scenarios',async()=>{
 for(let seed=0;seed<64;seed++){
  const rows=Array.from({length:1+seed%12},(_,index)=>line(String(1+(seed*137+index*71)%10001),{documentDiscountEligible:(index+seed)%3!==0,complimentaryReason:'Synthetic allocation'}));
  const eligible=rows.reduce((sum,row)=>sum+(row.documentDiscountEligible?BigInt(row.grossCents):0n),0n);
  await matching(rows,{kind:'fixed',cents:(eligible*BigInt(seed)/64n).toString()});
 }
});
for(const [label,rows,discount]of [
 ['empty lines',[],null],['object instead of lines',{},null],['too many lines',Array.from({length:1001},()=>line('1')),null],
 ['negative money',[line('-1')],null],['fractional money',[line('1.5')],null],['numeric JSON money',[line(100)],null],['leading-zero money',[line('01')],null],['overflow money',[line('9223372036854775808')],null],['overflow total',[line('9223372036854775807'),line('1')],null],
 ['unpriced field',[{...line('100'),quantity:2}],null],['untyped eligibility',[line('100',{documentDiscountEligible:'true'})],null],['missing reason field',[Object.fromEntries(Object.entries(line('100')).filter(([key])=>key!=='complimentaryReason'))],null],
 ['too precise percent',[line('100')],{kind:'percent',rate:'0.000000001'}],['percent above100',[line('100')],{kind:'percent',rate:'1.00000001'}],['numeric JSON rate',[line('100')],{kind:'percent',rate:0.1}],
 ['discount extra fields',[line('100')],{kind:'fixed',cents:'1',template:'not-selected'}],['unreasoned zero',[line('0')],null],['unreasoned full discount',[line('100')],{kind:'percent',rate:'1'}],
 ['empty reason',[line('0',{complimentaryReason:' \n '})],null],['control reason',[line('100',{complimentaryReason:'\u0001'})],null],['long reason',[line('100',{complimentaryReason:'x'.repeat(1001)})],null],
 ['excess document discount',[line('100')],{kind:'fixed',cents:'101'}],['excess line discount',[line('100',{lineDiscount:{kind:'fixed',cents:'101'}})],null],['discount on excluded subtotal',[line('100',{documentDiscountEligible:false})],{kind:'fixed',cents:'1'}]
])test('refuses '+label+' rather than clamping or trusting supplied values',async()=>{await assert.rejects(calculate(rows,discount),error=>error.code==='22023'&&/^CREST_QUOTE_/.test(error.message));});
test('rejects duplicate stable line identity and trailing noncanonical stored strings',async()=>{
 const row=line('100');await assert.rejects(calculate([row,row]),error=>error.code==='22023');
 for(const ending of ['\n','\r','\r\n'])for(const patch of [{id:row.id+ending},{grossCents:'100'+ending},{lineDiscount:{kind:'fixed',cents:'1'+ending}},{lineDiscount:{kind:'percent',rate:'0.1'+ending}}])await assert.rejects(calculate([{...row,...patch}]),error=>error.code==='22023');
});
