// Actual restricted export principal: parent and field pages share one held
// snapshot. Included-source consistency only; not full recovery or activation.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {createFieldOperationFixture} from '../support/field-operation-fixture.mjs';
import {collectAcceptedAmendmentSources} from '../support/accepted-amendment-source-fixture.mjs';
import {collectFieldSourcesInSnapshot} from '../../src/operations/field-source-collector.ts';
import {formatAcceptedQuoteAmendmentSourceCsv,formatFieldAcceptedQuoteAmendmentSourceCsv} from '../../src/commercial/quote-amendment-source-csv.ts';
import {verifyAcceptedAmendmentSourceGraph} from '../../src/commercial/quote-amendment-accepted-source.ts';
import {verifyFieldBookingParents,verifyFieldAllocationPlan} from '../../src/operations/field-plan-source.ts';
import {formatFieldWorkspaceSources} from '../../src/operations/field-workspace-source.ts';
import {bookingFoundationEvidence} from '../support/booking-source-evidence.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {reimportFieldWorkspaceSources} from '../support/field-workspace-reimport.mjs';
import {createAmendmentAcceptanceFixture} from '../support/amendment-acceptance-fixture.mjs';

const names=['field-time-storage','field-session-commands','work-completion-plan','work-completion-commands','field-scope-floor','mileage-evidence','mileage-field-profile','mobile-trip-interruption','unfulfilled-work-cancellation','support-trip-commands','field-originals','field-source','field-parent-source'];
const proposals=await Promise.all(names.map(n=>readFile(new URL('../../planning/proposals/'+n+'.sql',import.meta.url),'utf8')));
let sandbox,client,web,exporter,target,fixture,initial,accepted;
const roles=[];
const value=async(c,q,args=[])=>(await c.query(q,args)).rows[0].value;
async function tx(c,run,read=false){await c.query(read?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');try{const r=await run();await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}
async function loginAs(role){
 const name='synthetic_field_parent_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+name+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT '+role+' TO '+name);roles.push(name);
 const url=new URL(target);url.username=name;url.password=password;const c=await sandbox.connect(url.toString());await c.query('SET ROLE '+role);return c;
}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);assert.equal((await sandbox.apply(target,await sandbox.prefix(53))).history.length,53);
 web=await loginAs('crest_web');exporter=await loginAs('crest_export');
 accepted=createConfirmedBookingFixture({client,web,bootstrap:await value(client,"SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
 fixture=createFieldOperationFixture({client,web,accepted});for(const sql of proposals.slice(0,12))await tx(client,()=>client.query(sql));initial=await fixture.fixture();
},{timeout:240000});
after(async()=>{await web?.end();await exporter?.end();for(const role of roles)await sandbox.admin.query('DROP ROLE '+role);await sandbox?.close();});

test('old accepted-source footprint refuses the held field schema before reviewed adoption',async()=>{
 await assert.rejects(tx(exporter,()=>collectAcceptedAmendmentSources(exporter,initial.business),true),e=>e.code==='42501'&&e.message==='CREST_ACCEPTED_AMENDMENT_SOURCE_REVIEW_REQUIRED');
});
test('parent profile refuses predecessor drift unsafe defaults and disabled RLS',async()=>{
 for(const mutation of ["ALTER FUNCTION crest_commands.quote_commercial_snapshot_context(uuid) SET statement_timeout='1s'",'ALTER DEFAULT PRIVILEGES FOR ROLE crest_quote_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC','ALTER TABLE crest.jobs NO FORCE ROW LEVEL SECURITY']){
  await client.query('BEGIN');try{await client.query(mutation);await assert.rejects(client.query(proposals[12]),e=>e.code==='42501'&&e.message==='CREST_FIELD_PARENT_SOURCE_REVIEW_REQUIRED');}finally{await client.query('ROLLBACK');}
 }
});
test('reviewed parent adoption changes only the two accepted-source footprints',async()=>{
 const before=(await client.query("SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid=ANY(ARRAY['crest_commands.booking_source_snapshot_context(uuid)'::regprocedure,'crest_commands.field_source_context(uuid)'::regprocedure,'crest_commands.quote_amendment_accepted_source_context(uuid)'::regprocedure,'crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)'::regprocedure,'crest_commands.quote_commercial_snapshot_context(uuid)'::regprocedure,'crest_commands.quote_review_snapshot_context(uuid)'::regprocedure]) ORDER BY oid")).rows;
 await tx(client,()=>client.query(proposals[12]));
 for(const row of before){const after=await value(client,'SELECT pg_get_functiondef($1::regprocedure) value',[row.signature]);assert.equal(after,row.signature.includes('.quote_amendment_accepted_source_context(')||row.signature.includes('.quote_amendment_accepted_source_plans(')?row.definition.replace('88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'):row.definition);}
 assert.equal(await value(client,"SELECT has_schema_privilege('crest_quote_owner','crest_commands','CREATE') value"),false);
 for(const role of ['anon','authenticated','crest_web','crest_worker','crest_recovery'])assert.equal(await value(client,'SELECT has_function_privilege($1,$2,$3) value',[role,'crest_commands.quote_amendment_accepted_source_context(uuid)','EXECUTE']),false);
});
async function capture(p){return tx(exporter,async()=>{
 const parent=await collectAcceptedAmendmentSources(exporter,p.business);
 const queries=[];const connection={async query(sql,args){queries.push(sql);return exporter.query(sql,args);}};
 const field=(await collectFieldSourcesInSnapshot(connection,p.business,new AbortController().signal)).forServer();
 assert(!queries.some(sql=>/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)));assert.equal(await value(exporter,"SELECT current_setting('transaction_isolation') value"),'repeatable read');
 const foundation=await bookingFoundationEvidence(exporter,p.business),crm={};
 const historyRecords=JSON.parse(foundation.history).records;
 assert.deepEqual(historyRecords,JSON.parse(parent.historyEvidence).records);assert.deepEqual(historyRecords,JSON.parse(field.historyEvidence).records);
 for(const [name,routine,fieldName]of [['customers','customer','customers'],['addresses','address','addresses'],['vehicles','vehicle','vehicles'],['associations','association','associations']]){
  const context=await value(exporter,'SELECT crest_commands.'+routine+'_snapshot_context($1) value',[p.business]),rows=[];let after=null,done=false;
  for(let n=0;n<10001;n++){const page=await value(exporter,'SELECT crest_commands.'+routine+'_snapshot_page($1,$2,$3,20) value',[p.business,context.snapshotToken,after]);assert.equal(page.businessId,p.business);assert.equal(page.snapshotToken,context.snapshotToken);for(const row of page[fieldName]){assert(after===null||row.id>after);rows.push(row);after=row.id;}if(page[fieldName].length<20){done=true;break;}}assert(done);assert.equal(String(rows.length),context.rowCount);
  crm[name]={businessId:p.business,snapshotToken:context.snapshotToken,expectedRowCount:context.rowCount,rows};
 }
 const workspace={...foundation,commercial:{...parent,historyEvidence:foundation.history},field:{...field,historyEvidence:foundation.history},crm};
 return {parent,field,workspace};
},true);}
for(const kind of ['operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.mileage.record','operations.support_trip.record','operations.support_trip.correct'])test('field-inclusive source and accepted-plan graph: '+kind,async()=>{
 const planned=await fixture.plan(kind);
 try{assert.equal((await value(web,planned.sql,planned.args)).state,'committed');}catch(e){
  if(e.constraint==='operations_check1'){
   const stamps=(e.detail??'').match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?/g)??[];
   e.message+=' [OPERATION_CHECK_DIAGNOSTIC '+JSON.stringify({constraint:e.constraint,stampCount:stamps.length,committedBeforeCreated:stamps.length===2?stamps[0]<stamps[1]:null})+']';throw e;
  }throw e;
 }
 const {parent,field,workspace}=await capture(planned.p),audits=new Map(),operations=new Map();
 for(const record of JSON.parse(parent.historyEvidence).records){const row=JSON.parse(record.canonicalEvidence).row;if(record.kind==='operation')operations.set(row.operation_id,row);else audits.set(row.entity_kind+':'+row.entity_id+':'+row.entity_version,row);}
 verifyFieldBookingParents(field,parent.bookings);
 verifyAcceptedAmendmentSourceGraph({businessId:parent.businessId,field,rows:parent.rows,quotes:parent.quotes,bookings:parent.bookings,audits,operations});
 if(kind==='operations.job.complete'){
  const operation=operations.get(planned.original.reference.operationId),plan=parent.bookings.rows.allocation_plan_versions.find(row=>row.operation_id===operation.operation_id);
  const input={businessId:parent.businessId,field,plan,previous:parent.bookings.rows.allocation_plan_versions.find(row=>row.id===plan.replaces_id),operation,
   parts:parent.bookings.rows.allocation_plan_parts.filter(row=>row.plan_id===plan.id),previousParts:parent.bookings.rows.allocation_plan_parts.filter(row=>row.plan_id===plan.replaces_id),events:parent.bookings.rows.job_events};
  verifyFieldAllocationPlan(input);
  for(const mutate of [
   v=>{const e=v.events.find(row=>row.operation_id===operation.operation_id),body=JSON.parse(e.evidence);body.request.expectedVersion='1';e.evidence=JSON.stringify(body);},
   v=>{v.parts[0].amount_cents=String(BigInt(v.parts[0].amount_cents)+1n);},
   v=>{v.field.rows.work_scope_outcomes=[];},
  ]){const wrong=structuredClone(input);mutate(wrong);assert.throws(()=>verifyFieldAllocationPlan(wrong));}
 }
 const formatted=formatFieldAcceptedQuoteAmendmentSourceCsv(parent,field),manifest=JSON.parse(formatted.manifest);
 assert.equal(manifest.profile,'crest.quote-amendment.field-sources.v3');assert.equal(manifest.includedFieldBookingReferencesChecked,true);assert.equal(manifest.completeCrestExport,false);assert.equal(manifest.completeBackup,false);assert(formatted.fieldFiles);
 const complete=formatFieldWorkspaceSources(workspace),closed=JSON.parse(complete.manifest);
 assert.equal(closed.includedBookingHistoryVerified,true);assert.equal(closed.includedFieldForeignKeysVerified,true);assert.equal(closed.includedActorAndMembershipReferencesVerified,true);assert.equal(closed.completePortableExport,false);assert.equal(closed.completeBackup,false);
 for(const part of closed.parts){const actual=complete.parts.find(p=>p.name===part.name);assert(actual);assert.equal(Buffer.byteLength(actual.content),part.bytes);assert.equal(createHash('sha256').update(actual.content).digest('hex'),part.sha256);}
 const missing=structuredClone(workspace);missing.crm.vehicles.rows=[];missing.crm.vehicles.expectedRowCount='0';assert.throws(()=>formatFieldWorkspaceSources(missing));
 if(['operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled'].includes(kind))assert.throws(()=>formatAcceptedQuoteAmendmentSourceCsv(parent));
 const wrong=structuredClone(parent);wrong.bookings.rows.jobs[0].operator_actor_id='00000000-0000-4000-8000-000000000001';assert.throws(()=>formatFieldAcceptedQuoteAmendmentSourceCsv(wrong,field));
});
test('snapshot composition refuses an ordinary transaction without starting or committing one',async()=>{
 const queries=[];const connection={async query(sql,args){queries.push(sql);return exporter.query(sql,args);}};
 await assert.rejects(collectFieldSourcesInSnapshot(connection,initial.business,new AbortController().signal));
 assert(!queries.some(sql=>/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)));
});
test('partial completion exports every conserved fulfilled and unfulfilled piece',async()=>{
 const p=await fixture.fixture();await fixture.field(p,'direct_arrive');const body=await fixture.completion(p),original=body.scope[0].pieces[0];
 const gross=BigInt(original.grossInclusiveCents)/2n,discount=BigInt(original.discountInclusiveCents)/2n;
 body.scope[0].pieces=[{...original,grossInclusiveCents:String(gross),discountInclusiveCents:String(discount),amountCents:String(gross-discount)},
  {...original,partitionId:randomUUID(),outcome:'unfulfilled',reason:'Synthetic remaining work',scopeDescription:'Synthetic unfinished portion',grossInclusiveCents:String(BigInt(original.grossInclusiveCents)-gross),discountInclusiveCents:String(BigInt(original.discountInclusiveCents)-discount),amountCents:String(BigInt(original.amountCents)-(gross-discount))}];
 const r=await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),p.job,p.version,body]);assert.equal(r.state,'committed');
 const {parent,field,workspace}=await capture(p);assert(field.rows.work_scope_outcomes.some(o=>o.outcome==='completed'));assert(field.rows.work_scope_outcomes.some(o=>o.outcome==='unfulfilled'));
 assert.equal(JSON.parse(formatFieldAcceptedQuoteAmendmentSourceCsv(parent,field).manifest).includedFieldBookingReferencesChecked,true);
 assert.equal(JSON.parse(formatFieldWorkspaceSources(workspace).manifest).includedBookingHistoryVerified,true);
});
test('a standalone support trip remains included without inventing a job link',async()=>{
 const planned=await fixture.plan('operations.support_trip.record');planned.args.at(-1).trip.jobId=null;
 assert.equal((await value(web,planned.sql,planned.args)).state,'committed');const {parent,field,workspace}=await capture(planned.p);
 assert.equal(field.rows.travel_legs.length,1);assert.equal(field.rows.travel_legs[0].job_context_id,null);
 assert(formatFieldAcceptedQuoteAmendmentSourceCsv(parent,field).fieldFiles);
 assert.equal(JSON.parse(formatFieldWorkspaceSources(workspace).manifest).includedFieldForeignKeysVerified,true);
});
test('linked vehicle and changed current CRM keep original booked snapshots and closed association history',async()=>{
 const p=await accepted(null),associationId=randomUUID();
 const body={action:'open',associationId,customerId:p.customer,vehicleId:p.vehicle,effectiveAt:'2026-01-01T00:00:00.000000Z',relationship:'owner',isBilling:true,evidence:'Synthetic field export relationship',reason:null,nextAssociationId:null};
 assert.equal((await value(web,'SELECT crest_commands.change_vehicle_association($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,0,$11) value',[...p.auth(),p.epoch,randomUUID(),body])).state,'committed');
 const q=confirmedBookingRequest(p);q.payload.vehicles[0].customerVehicleId=associationId;
 assert.equal((await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,q.operationId,q.jobId,q.expectedModeSequence,q.payload])).state,'committed');
 assert.equal((await value(web,'SELECT crest_commands.change_vehicle_association($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,1,$11) value',[...p.auth(),p.epoch,randomUUID(),{...body,action:'close',effectiveAt:'2026-11-04T00:00:00.000000Z',relationship:null,isBilling:null,evidence:null,reason:'Synthetic relationship ended'}])).state,'committed');
 assert.equal((await value(web,'SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) value',[...p.auth(),p.epoch,randomUUID(),p.customer,{displayName:'Synthetic renamed customer',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:'=Retain historical name\nCafé',customerSince:null,archived:false,archiveReason:null}])).state,'committed');
 const {workspace}=await capture(p);assert.equal(workspace.crm.associations.rows[0].version,'2');assert.equal(workspace.crm.customers.rows[0].version,'2');
 const formatted=formatFieldWorkspaceSources(workspace);assert.equal(JSON.parse(formatted.manifest).includedCrmCurrentAndHistoricalReferencesVerified,true);
 const wrong=structuredClone(workspace);wrong.commercial.bookings.rows.jobs[0].label='Synthetic unaudited edit';assert.throws(()=>formatFieldWorkspaceSources(wrong));
});
test('accepted work without a booked job exports without inventing field records',async()=>{
 const p=await accepted(null),{workspace}=await capture(p);assert.equal(workspace.commercial.bookings.rows.jobs.length,0);
 for(const rows of Object.values(workspace.field.rows))assert.equal(rows.length,0);
 assert.equal(JSON.parse(formatFieldWorkspaceSources(workspace).manifest).includedBookingHistoryVerified,true);
});
test('all eleven populated field groups and their parents reimport into47 neutral SQL tables with actual foreign keys',async()=>{
 const p=await fixture.fixture({contact:true});await fixture.field(p,'direct_arrive');await fixture.field(p,'pause');
 const legId=randomUUID(),trip=await value(web,'SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),legId,null,fixture.tripBody(p)]);assert.equal(trip.state,'committed');
 for(const [version,actual,reason]of [['0','9999999999.9999',null],['1','1.0000','Synthetic corrected mileage']]){
  const r=await value(web,'SELECT crest_commands.record_mileage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) value',[...p.auth(),p.epoch,randomUUID(),legId,trip.receipt.legVersionId,version,{source:'manual_actual',movementKind:'business_rig',actualMiles:actual,estimateMiles:null,estimateSource:null,odometerStart:null,odometerEnd:null,notes:'=Retain original miles\nCafé \\N',reason,allocationState:'allocated',allocations:[{jobId:p.job,fraction:'1.00000000'}]}]);assert.equal(r.state,'committed');
 }
 await fixture.field(p,'resume');const body=await fixture.completion(p);body.review={...body.review,reviewUrl:'https://example.com/synthetic-review',expectedCustomerVersion:'2',contactReviewReason:'Synthetic current contact reviewed'};
 const completed=await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),p.job,p.version,body]);assert.equal(completed.state,'committed');
 const {workspace}=await capture(p);for(const [name,rows]of Object.entries(workspace.field.rows))assert(rows.length>0,name);
 assert.equal(workspace.field.rows.mileage_evidence.length,2);assert.equal(workspace.field.rows.messages[0].state,'prepared');
 const bundle=formatFieldWorkspaceSources(workspace),commercial=formatFieldAcceptedQuoteAmendmentSourceCsv(workspace.commercial,workspace.field),neutral=await sandbox.connect(await sandbox.database());
 try{const imported=await reimportFieldWorkspaceSources(neutral,bundle,commercial,workspace);assert.equal(imported.tables,47);assert.equal(imported.allFieldColumns,164);assert(imported.foreignKeys>100);assert.equal(imported.applicationRestore,false);}
 finally{await neutral.end();}
});
for(const state of ['completed','paused'])test('accepted amendment preserves joined source history for '+state+' field work',async()=>{
 const p=await fixture.fixture();await fixture.field(p,'direct_arrive');
 if(state==='paused')await fixture.field(p,'pause');
 else assert.equal((await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),p.job,p.version,await fixture.completion(p)])).state,'committed');
 const before=await capture(p),amendments=createAmendmentAcceptanceFixture({client,web}),request=await amendments.sentAmendment(p);
 assert.equal((await amendments.acceptAmendment(p,request)).state,'committed');
 const {workspace}=await capture(p);assert.equal(workspace.commercial.rows.agreements.length,2);
 assert.deepEqual(workspace.field.rows.work_scope_outcomes,before.workspace.field.rows.work_scope_outcomes);
 assert.deepEqual(workspace.field.rows.work_intervals,before.workspace.field.rows.work_intervals);
 assert.equal(JSON.parse(formatFieldWorkspaceSources(workspace).manifest).includedBookingHistoryVerified,true);
});
test('field-inclusive accepted context keeps unknown future finance schema closed',async()=>{
 await client.query('BEGIN');try{await client.query('SET LOCAL ROLE crest_schema_owner');await client.query('CREATE TABLE crest.unreviewed_financial_source(id uuid)');await client.query('RESET ROLE');await assert.rejects(client.query('SELECT crest_commands.quote_amendment_accepted_source_context($1)',[initial.business]),e=>e.code==='42501');}finally{await client.query('ROLLBACK');}
});
