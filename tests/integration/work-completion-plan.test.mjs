// Actual locked PostgreSQL sources, independent TS comparison. The private
// planner grants no completion/write authority and is not a product endpoint.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {planCompletedScope} from '../../src/operations/work-completion.ts';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const [storage,commands,proposal]=await Promise.all(['planning/proposals/field-time-storage.sql','planning/proposals/field-session-commands.sql','planning/proposals/work-completion-plan.sql'].map(read));
let sandbox,client,web,login,f,foreign,scheduled,secondJob,plans;
const scalar=async(q,args=[])=>(await client.query(q,args)).rows[0].value;
async function tx(c,run){await c.query('BEGIN');try{const r=await run();await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}
async function book(p,q=confirmedBookingRequest(p)){const r=await tx(web,()=>web.query('SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...p.auth(),p.epoch,q.operationId,q.jobId,q.expectedModeSequence,q.payload]));assert.equal(r.rows[0].value.state,'committed');return q.jobId;}
async function field(p,action,version){const r=await tx(web,()=>web.query('SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...p.auth(),p.epoch,randomUUID(),p.job,version,{action,reason:action==='direct_arrive'?'Synthetic omitted travel':action==='pause'?'Synthetic interruption':null}]));assert.equal(r.rows[0].value.state,'committed');p.version=r.rows[0].value.receipt.jobVersion;}
async function context(p,run){return tx(client,async()=>{await client.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true)",[p.business,p.actor]);return run();});}
async function load(p=f){return context(p,()=>scalar('SELECT crest_private.load_completion_plans($1,$2) AS value',[p.business,p.job]));}
async function planned(input,p=f,version=p.version){return context(p,()=>scalar('SELECT crest_private.plan_completed_scope($1,$2,$3,$4) AS value',[p.business,p.job,version,JSON.stringify(input)]));}
const rows=(source=plans)=>source.flatMap(p=>p.parts.filter(x=>x.jobId===f.job&&x.state==='assigned').map(a=>({assignedPartId:a.id,expectedPlanId:p.planId,expectedPlanSequence:p.planSequence,pieces:[{partitionId:a.partitionId,outcome:'completed',scopeDescription:a.scopeDescription,grossInclusiveCents:a.grossInclusiveCents,discountInclusiveCents:a.discountInclusiveCents,amountCents:a.amountCents,reason:null}]})));
function split(){const input=rows(),i=input.findIndex(o=>BigInt(o.pieces[0].amountCents)>0n),a=input[i].pieces[0],g=BigInt(a.grossInclusiveCents),d=BigInt(a.discountInclusiveCents),firstGross=g/2n,firstDiscount=d/2n;input[i].pieces=[{...a,scopeDescription:'Synthetic interior fulfilled',grossInclusiveCents:firstGross.toString(),discountInclusiveCents:firstDiscount.toString(),amountCents:(firstGross-firstDiscount).toString()},{...a,partitionId:randomUUID(),outcome:'unfulfilled',scopeDescription:'Synthetic exterior not performed',grossInclusiveCents:(g-firstGross).toString(),discountInclusiveCents:(d-firstDiscount).toString(),amountCents:(g-firstGross-d+firstDiscount).toString(),reason:'Synthetic partial stop; commercial resolution required'}];return input;}
async function refused(input,p=f,version=p.version){await assert.rejects(planned(input,p,version),e=>e.code==='22023'&&e.message==='CREST_COMPLETION_REVIEW_REQUIRED');}
before(async()=>{
 sandbox=await migrationSandbox();const target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);assert.equal((await sandbox.apply(target,await sandbox.prefix(53))).history.length,53);
 login='crest_completion_fixture_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());await web.query('SET ROLE crest_web');
 const accepted=createConfirmedBookingFixture({client,web,bootstrap:await scalar("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'")});f=await accepted(null,{paidLineDiscount:{kind:'fixed',cents:'5000'}});const first=confirmedBookingRequest(f);let paid,original,remainder;
 for(const plan of first.payload.allocationPlans){if(BigInt(plan.parts[0].amountCents)>0n){paid=plan;original={...plan.parts[0]};const g=BigInt(original.grossInclusiveCents)/2n,d=BigInt(original.discountInclusiveCents)/2n;remainder=randomUUID();plan.parts=[{...original,grossInclusiveCents:g.toString(),discountInclusiveCents:d.toString(),amountCents:(g-d).toString()},{...original,partitionId:remainder,jobId:null,state:'unassigned',grossInclusiveCents:(BigInt(original.grossInclusiveCents)-g).toString(),discountInclusiveCents:(BigInt(original.discountInclusiveCents)-d).toString(),amountCents:(BigInt(original.amountCents)-g+d).toString()}];}}
 assert(paid&&original&&remainder);f.job=await book(f,first);const second=confirmedBookingRequest(f);second.expectedModeSequence='1';for(const k of ['start_at','end_at','local_start','local_end'])second.payload.appointment[k]=second.payload.appointment[k].replace('2026-11-03','2026-11-04');second.payload.allocationPlans=[{...paid,expectedSequence:'1',parts:paid.parts.map(p=>p.partitionId===remainder?{...p,jobId:second.jobId,state:'assigned'}:{...p})}];secondJob=await book(f,second);
 foreign=await accepted();foreign.job=await book(foreign);scheduled=await accepted();scheduled.job=await book(scheduled);scheduled.version='1';
 await tx(client,()=>client.query(storage));await tx(client,()=>client.query(commands));await field(f,'direct_arrive','1');
},{timeout:240000});
after(async()=>{await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
test('unsafe routine defaults refuse installation before any private completion helper exists',async()=>{
 await client.query('BEGIN');try{await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT EXECUTE ON ROUTINES TO crest_web');await assert.rejects(client.query(proposal),e=>e.code==='42501'&&e.message==='CREST_COMPLETION_SOURCE_REVIEW_REQUIRED');}finally{await client.query('ROLLBACK');}assert.equal(await scalar("SELECT to_regprocedure('crest_private.plan_completed_scope(uuid,uuid,bigint,jsonb)') AS value"),null);
});
test('installs only closed private helpers with fixed role and search path',async()=>{
 await tx(client,()=>client.query(proposal));for(const signature of ['crest_private.load_completion_plans(uuid,uuid)','crest_private.plan_completed_scope(uuid,uuid,bigint,jsonb)']){const p=(await client.query("SELECT proowner='crest_booking_owner'::regrole AS owner,prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure",[signature])).rows[0];assert(p.owner&&p.prosecdef&&p.proconfig.includes('row_security=on')&&p.proconfig.includes('search_path=pg_catalog, pg_temp'));for(const role of ['crest_web','crest_worker'])assert.equal(await scalar('SELECT has_function_privilege($1,$2,$3) AS value',[role,signature,'EXECUTE']),false);}
});
test('copied actor/business settings give ordinary web no completion planning authority',async()=>{
 await web.query('BEGIN');try{await web.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true)",[f.business,f.actor]);await assert.rejects(web.query('SELECT crest_private.load_completion_plans($1,$2)',[f.business,f.job]),e=>e.code==='42501');}finally{await web.query('ROLLBACK');}
});
test('loads genuine current assigned, complimentary and another-visit source without inventing scope',async()=>{
 plans=await load();assert.equal(plans.length,2);assert(plans.some(p=>p.amountCents==='0'));assert(plans.some(p=>p.discountInclusiveCents==='5000'));assert(plans.some(p=>p.parts.some(a=>a.jobId===secondJob)));assert(plans.some(p=>p.planSequence==='2'));
});
test('actual full completion plan matches the independent application calculator and keeps another visit exact',async()=>{
 const input=rows(),r=await planned(input);assert.deepEqual(r,planCompletedScope(f.job,plans,input));assert.equal(r.completionOutcome,'full');assert.equal(r.needsCommercialResolution,false);const original=plans.flatMap(p=>p.parts).find(p=>p.jobId===secondJob),retained=r.plans.flatMap(p=>p.parts).find(p=>p.jobId===secondJob);const old=Object.fromEntries(Object.entries(original).filter(([key])=>key!=='id'));assert.deepEqual(retained,old);assert.equal(r.fulfilledPortions,2);
});
test('actual partial completion preserves each accepted envelope and marks commercial resolution',async()=>{
 const input=split(),r=await planned(input);assert.deepEqual(r,planCompletedScope(f.job,plans,input));assert.equal(r.completionOutcome,'partial');assert.equal(r.needsCommercialResolution,true);assert.equal(r.unfulfilledPortions,1);assert(r.outcomes.some(o=>o.outcome==='unfulfilled'&&o.completedCents==='0'));assert(!Object.hasOwn(r,'invoice'));
});
test('cannot omit a zero-dollar scope merely because the monetary totals would still balance',async()=>{const input=rows().filter(o=>o.pieces[0].amountCents!=='0');await refused(input);});
test('stale plan/job version and duplicate assigned sources refuse without a mutation',async()=>{
 const input=rows();await refused([{...input[0],expectedPlanId:randomUUID()},...input.slice(1)]);await refused([{...input[0],expectedPlanSequence:'999'},...input.slice(1)]);await refused([...input,input[0]]);await refused(input,f,'1');
});
test('cannot use another job or foreign-business source in this completion',async()=>{
 const input=rows();await refused([...input,{...input[0],assignedPartId:randomUUID()}]);await refused(input,{...foreign,job:f.job,version:'2'});
});
test('all unfulfilled scope belongs in cancellation and is never reported as a completion',async()=>{await refused(rows().map(o=>({...o,pieces:o.pieces.map(p=>({...p,outcome:'unfulfilled',reason:'Synthetic no scope fulfilled'}))})));});
test('one cent cannot be added to a single source envelope or hidden by aggregate balancing',async()=>{
 const input=split(),i=input.findIndex(o=>o.pieces.length===2),a=input[i].pieces[0];input[i].pieces[0]={...a,grossInclusiveCents:(BigInt(a.grossInclusiveCents)+1n).toString(),amountCents:(BigInt(a.amountCents)+1n).toString()};await refused(input);
 const balanced=rows(),zero=balanced.findIndex(o=>o.pieces[0].amountCents==='0'),paid=balanced.findIndex(o=>BigInt(o.pieces[0].amountCents)>0n);balanced[zero].pieces[0]={...balanced[zero].pieces[0],grossInclusiveCents:'1',amountCents:'1'};balanced[paid].pieces[0]={...balanced[paid].pieces[0],grossInclusiveCents:(BigInt(balanced[paid].pieces[0].grossInclusiveCents)-1n).toString(),amountCents:(BigInt(balanced[paid].pieces[0].amountCents)-1n).toString()};await refused(balanced);
});
test('cannot steal an unrelated partition identity or discard the original identity',async()=>{
 const input=split(),i=input.findIndex(o=>o.pieces.length===2),other=plans.flatMap(p=>p.parts).find(p=>p.jobId===secondJob);input[i].pieces[1].partitionId=other.partitionId;await refused(input);const changed=split(),j=changed.findIndex(o=>o.pieces.length===2);changed[j].pieces[0].partitionId=randomUUID();await refused(changed);
});
test('unperformed scope needs factual reasons and integer strings, with no extra posting flags',async()=>{
 for(const patch of [{reason:null},{reason:' '},{amountCents:0},{scopeDescription:'\u0001bad'}]){const input=split(),i=input.findIndex(o=>o.pieces.length===2);input[i].pieces[1]={...input[i].pieces[1],...patch};await refused(input);}const input=rows();await refused([{...input[0],paid:true},...input.slice(1)]);
});
test('a scheduled job cannot bypass Start Work by obtaining a completion plan',async()=>{await refused(rows(),scheduled,'1');});
test('the same real job can plan completion while paused without altering first work time',async()=>{
 const first=await scalar('SELECT first_work_at AS value FROM crest.jobs WHERE id=$1',[f.job]);await field(f,'pause','2');const input=rows(),r=await planned(input);assert.deepEqual(r,planCompletedScope(f.job,plans,input));assert.equal((await scalar('SELECT first_work_at AS value FROM crest.jobs WHERE id=$1',[f.job])).toISOString(),first.toISOString());
});
test('planning creates no completion, outcome, receipt, review, invoice or financial source',async()=>{
 const snapshot=()=>scalar("SELECT jsonb_build_object('version',j.version::text,'state',j.state,'completed',j.completed_at,'operations',(SELECT count(*) FROM crest_private.operations),'audits',(SELECT count(*) FROM crest_private.audit_events),'plans',(SELECT count(*) FROM crest.allocation_plan_versions),'parts',(SELECT count(*) FROM crest.allocation_plan_parts),'events',(SELECT count(*) FROM crest.job_events)) AS value FROM crest.jobs j WHERE id=$1",[f.job]);const before=await snapshot();const input=rows();assert.deepEqual(await planned(input),await planned(input));assert.deepEqual(await snapshot(),before);assert.equal(before.state,'paused');assert.equal(before.completed,null);assert.equal(await scalar('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),53);
});
