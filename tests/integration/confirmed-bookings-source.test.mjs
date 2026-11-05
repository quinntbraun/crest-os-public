// Actual export credential, held snapshots and neutral CSV/JSON reimport.
// Construction over49; not a complete business export or production recovery.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {bookingRecordGroups,bookingRecordSchema} from '../../src/operations/confirmed-booking-records.ts';
import {formatBookingSourceCsv} from '../../src/operations/confirmed-booking-source-csv.ts';
import {formatBookingSourceHistory} from '../../src/operations/confirmed-booking-source-history.ts';
import {bookingFoundationEvidence,bookingCommercialEvidence} from '../support/booking-source-evidence.mjs';
import {createHash} from 'node:crypto';
import {verifyBusinessFoundationEvidence} from '../../src/security/business-configuration-evidence.ts';
import {formatQuoteCommercialCsv} from '../../src/commercial/quote-commercial-csv.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
const sourceSql=await readFile(new URL('../../planning/proposals/confirmed-bookings-source.sql',import.meta.url),'utf8');
let sandbox,target,client,web,exporter,webLogin,exportLogin,fixture,f,empty,first,second,secondResult,lastSchedule,snapshotData,formatted;
let closedSource,closedFiles;
const value=async(c,q,args=[])=>(await c.query(q,args)).rows[0]?.value;
async function transaction(c,work){await c.query('BEGIN');try{const v=await work();await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}}
const context=business=>value(exporter,'SELECT crest_commands.booking_source_snapshot_context($1) AS value',[business]);
const page=(business,token,group,after=null,size=2)=>value(exporter,'SELECT crest_commands.booking_source_snapshot_'+group+'($1,$2,$3,$4) AS value',[business,token,after,size]);
async function collect(business){const c=await context(business),rows={};for(const group of bookingRecordGroups){rows[group]=[];let after=null;for(;;){const p=await page(business,c.snapshotToken,group,after);assert.equal(p.businessId,business);assert.equal(p.snapshotToken,c.snapshotToken);assert.equal(p.schemaVersion,1);assert.equal(typeof p.hasMore,'boolean');assert(p.rows.length<=2);for(const row of p.rows){assert.equal(row.business_id,business);assert(after===null||row.id>after);rows[group].push(row);after=row.id;}if(!p.hasMore)break;assert.equal(p.rows.length,2);}assert.equal(String(rows[group].length),c.expectedCounts[group]);}return {businessId:business,snapshotToken:c.snapshotToken,commercialSnapshotToken:c.commercialSnapshotToken,historySnapshotToken:c.historySnapshotToken,expectedCounts:c.expectedCounts,rows};}
async function snapshot(business){await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{const r=await collect(business);await exporter.query('COMMIT');return r;}catch(e){await exporter.query('ROLLBACK');throw e;}}
async function role(prefix,as){const name=prefix+'1'+randomBytes(8).toString('hex');assert.match(name,/^crest_booking_source_(?:web|export)_1[a-f0-9]{16}$/);const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+name+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT '+as+' TO '+name);const url=new URL(target);url.username=name;url.password=password;const connection=await sandbox.connect(url.toString());await connection.query('SET ROLE '+as);return {name,connection};}
const book=(f,q,body=q.payload)=>transaction(web,()=>value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...f.auth(),f.epoch,q.operationId,q.jobId,q.expectedModeSequence,body]));
const cancel=(f,job)=>transaction(web,()=>value(web,'SELECT crest_commands.cancel_scheduled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...f.auth(),f.epoch,randomUUID(),job,'1',{reason:'Synthetic source history cancellation',customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}]));
const schedule=(f,r)=>transaction(web,()=>value(web,'SELECT crest_commands.change_job_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...f.auth(),f.epoch,r.operationId,r.jobId,r.expectedJobVersion,r.payload]));
function scheduleRequest(q,latest,version,action='propose'){
 const appointment=Object.fromEntries(Object.entries(q.payload.appointment).filter(([key])=>!['customer_confirmation','unknown_travel_reviewed'].includes(key)));Object.assign(appointment,{start_at:'2026-11-04T12:00:00.123456Z',end_at:'2026-11-04T13:00:00.123456Z',local_start:'2026-11-04T12:00:00.123456',local_end:'2026-11-04T13:00:00.123456',timezone:'UTC',start_offset_minutes:0,end_offset_minutes:0});
 return {operationId:randomUUID(),jobId:q.jobId,expectedJobVersion:version,payload:{action,reason:'=Owner-recorded source fixture schedule change',latestAppointmentId:latest,expectedModeSequence:action==='withdraw'?null:'2',appointment:action==='propose'?appointment:null,customerConfirmation:action==='confirm'?{channel:'phone',effectiveAt:new Date(Date.now()-1000).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z'),evidenceNote:'Factual synthetic confirmation'}:null,conflictReview:action==='confirm'?{expectedAppointmentIds:[],expectedUnknownTravel:false,unknownTravelReviewed:false,overrideReason:null}:null}};
}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target,await sandbox.prefix(49));
 await transaction(client,async()=>{for(const name of ['fulfillment-mode-storage','fulfillment-mode-commands','confirmed-bookings-storage','confirmed-bookings-history','confirmed-bookings-invariants','confirmed-bookings-job-invariants','confirmed-bookings-commands','confirmed-bookings-reads','confirmed-bookings-enable','confirmed-bookings-cancel','confirmed-bookings-reschedule','confirmed-bookings-reschedule-commands','confirmed-bookings-resolution','confirmed-bookings-original','confirmed-bookings-context'])await client.query(await readFile(new URL('../../planning/proposals/'+name+'.sql',import.meta.url),'utf8'));});await sandbox.apply(target,await sandbox.prefix(49));
 const w=await role('crest_booking_source_web_','crest_web');web=w.connection;webLogin=w.name;const bootstrap=await value(client,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");fixture=createConfirmedBookingFixture({client,web,bootstrap});f=await fixture();empty=await fixture();
 first=confirmedBookingRequest(f);const paid=first.payload.allocationPlans.find(p=>p.parts[0].amountCents!=='0'),base=paid.parts[0];paid.parts=[{...base,grossInclusiveCents:'12500',amountCents:'12500',scopeDescription:'=Synthetic interior, quoted scope\nLiteral \\N ★'}, {...base,partitionId:randomUUID(),jobId:null,state:'unassigned',grossInclusiveCents:'12500',amountCents:'12500',scopeDescription:'Remaining accepted synthetic scope'}];for(const p of first.payload.allocationPlans)p.reason='\\N';first.payload.allocationPlans.find(p=>p.parts[0].amountCents==='0').parts[0].scopeDescription="'Complimentary synthetic scope";first.payload.workLocation.instructions='Synthetic line one\nLiteral \\N';Object.assign(first.payload.appointment,{timezone:'America/Indiana/Indianapolis',local_start:'2026-11-03T05:00:00.123456',local_end:'2026-11-03T06:00:00.123456',start_offset_minutes:-300,end_offset_minutes:-300});
 const scaledBody=JSON.stringify(first.payload).replace('"schemaVersion":1','"schemaVersion":1.000');assert(scaledBody.includes('"schemaVersion":1.000'));const initial=await book(f,first,scaledBody);assert.equal(initial.state,'committed');
 second=confirmedBookingRequest(f);second.expectedModeSequence='1';second.payload.allocationPlans=[{...structuredClone(paid),expectedSequence:'1',reason:'Allocate the explicit remaining accepted half',parts:paid.parts.map((p,i)=>({...p,...i===1?{jobId:second.jobId,state:'assigned'}:{}}))}];second.payload.conflictReview.expectedAppointmentIds=[initial.receipt.appointmentId];second.payload.conflictReview.overrideReason='=Owner reviewed actual synthetic overlap before field work';secondResult=await book(f,second);assert.equal(secondResult.state,'committed');assert.equal((await cancel(f,first.jobId)).state,'committed');
 const mode=await value(web,'SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) AS value',[...f.auth(),f.epoch,randomUUID(),'1',{mobileEnabled:true,dropoffEnabled:false,pickupReturnEnabled:false,reason:'Owner updated synthetic availability'}]);assert.equal(mode.state,'committed');
 const proposed=await schedule(f,scheduleRequest(second,secondResult.receipt.appointmentId,'1'));assert.equal(proposed.state,'committed');const confirmed=await schedule(f,scheduleRequest(second,proposed.receipt.latestAppointmentId,'2','confirm'));assert.equal(confirmed.state,'committed');const proposal=await schedule(f,scheduleRequest(second,confirmed.receipt.latestAppointmentId,'3'));assert.equal(proposal.state,'committed');const withdrawn=await schedule(f,scheduleRequest(second,proposal.receipt.latestAppointmentId,'4','withdraw'));assert.equal(withdrawn.state,'committed');lastSchedule=withdrawn;
},{timeout:240000});
after(async()=>{await exporter?.end();await web?.end();if(exportLogin)await sandbox.admin.query('DROP ROLE '+exportLogin);if(webLogin)await sandbox.admin.query('DROP ROLE '+webLogin);await sandbox?.close();});
test('closed source inventory exactly matches all154 added physical columns, types and nullability',async()=>{
 const rows=(await client.query("SELECT c.relname AS table,a.attname AS column,t.typname AS type,a.attnotnull AS required FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid WHERE n.nspname='crest' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum",[bookingRecordGroups])).rows;assert.equal(rows.length,154);
 for(const group of bookingRecordGroups){const actual=rows.filter(v=>v.table===group),expected=Object.entries(bookingRecordSchema[group]);assert.deepEqual(actual.map(v=>v.column),expected.map(([name])=>name));for(const [index,[,field]]of expected.entries()){const actualType={int8:'bigint',int4:'integer',bool:'boolean'}[actual[index].type]??actual[index].type;assert.equal(actualType,field.type,group+'.'+actual[index].column);assert.equal(!actual[index].required,field.nullable,group+'.'+actual[index].column);}}
});
test('unsafe defaults reject source installation, and source reads require the separate explicit export credential',async()=>{
 await client.query('BEGIN');await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC');await assert.rejects(client.query(sourceSql),e=>e.code==='42501'&&e.message==='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED');await client.query('ROLLBACK');assert.equal(await value(client,"SELECT to_regprocedure('crest_commands.booking_source_snapshot_context(uuid)') AS value"),null);
 await transaction(client,()=>client.query(sourceSql));const e=await role('crest_booking_source_export_','crest_export');exporter=e.connection;exportLogin=e.name;
 await assert.rejects(web.query('SELECT crest_commands.booking_source_snapshot_context($1)',[f.business]),e=>e.code==='42501');await assert.rejects(exporter.query('SELECT * FROM crest.jobs'),e=>e.code==='42501');await assert.rejects(context(f.business),e=>e.code==='25001');await exporter.query('RESET ROLE');await assert.rejects(context(f.business),e=>e.code==='42501');await exporter.query('SET ROLE crest_export');
});
test('empty business source is truthful, complete for the included12 tables, and bound to its own snapshot',async()=>{
 const emptySource=await snapshot(empty.business);assert(Object.values(emptySource.expectedCounts).every(v=>v==='0'));assert(Object.values(emptySource.rows).every(v=>v.length===0));const files=formatBookingSourceCsv(emptySource);assert.equal(Object.keys(files.tables).length,12);assert.equal(JSON.parse(files.manifest).completePortableExport,false);await exporter.query('BEGIN READ ONLY');await assert.rejects(context(f.business),e=>e.code==='25001');await exporter.query('ROLLBACK');
});
test('all physical sources page without omissions and preserve exact JSON numeric text, instants, zeros and drafts',async()=>{
 snapshotData=await snapshot(f.business);assert(bookingRecordGroups.every(g=>snapshotData.rows[g].length>0));formatted=formatBookingSourceCsv(snapshotData);assert.match(snapshotData.rows.jobs.find(v=>v.id===first.jobId).work_location_snapshot,/"schemaVersion":\s*1\.000\b/);assert(snapshotData.rows.job_events.some(v=>v.evidence.includes('1.000')));assert(snapshotData.rows.allocation_plan_parts.some(v=>v.amount_cents==='0'));assert(snapshotData.rows.appointments.some(v=>v.start_at==='2026-11-03T10:00:00.123456Z'&&v.start_offset_minutes===-300));assert(snapshotData.rows.appointments.some(v=>v.confirmation_state==='withdrawn'));const manifest=JSON.parse(formatted.manifest);assert.equal(manifest.parts.length,37);assert.equal(manifest.completeBackup,false);assert.equal(manifest.externalReferenceClosureComplete,false);
});
test('CSV neutral reimport recovers every physical source value, including formula prefixes, SQL nulls and original JSONB text',async()=>{
 await client.query('CREATE TEMP TABLE booking_source_roundtrip(entity text,source_row jsonb)');let mapped=0;
 for(const group of bookingRecordGroups){const spec=bookingRecordSchema[group],columns=Object.keys(spec),parts=formatted.tables[group],csv=readCustomerCsv(parts.csv),escapeMap=JSON.parse(parts.escapeMap);assert.deepEqual(csv.shift(),columns);mapped+=escapeMap.escapes.length;const decoded=csv.map(cells=>{const id=cells[columns.indexOf('id')];return Object.fromEntries(columns.map((column,index)=>{let value=cells[index];if(value==='\\N')return[column,null];if(escapeMap.escapes.some(v=>v.row_id===id&&v.column===column)){assert(value.startsWith("'"));value=value.slice(1);}value=value.replaceAll('\\\\','\\');const type=spec[column].type;if(type==='boolean'){assert(['true','false'].includes(value));return[column,value==='true'];}if(type==='integer'){assert(/^-?(0|[1-9][0-9]*)$/.test(value));return[column,Number(value)];}return[column,value];}));});assert.deepEqual(decoded,snapshotData.rows[group].toSorted((a,b)=>a.id<b.id?-1:1));for(const row of decoded)await client.query('INSERT INTO booking_source_roundtrip(entity,source_row) VALUES($1,$2)',[group,row]);}
 assert(mapped>0);const same=await value(client,"SELECT ((source_row->>'work_location_snapshot')::jsonb)::text AS value FROM booking_source_roundtrip WHERE entity='jobs' AND source_row->>'id'=$1",[first.jobId]);assert.equal(same,await value(client,'SELECT work_location_snapshot::text AS value FROM crest.jobs WHERE business_id=$1 AND id=$2',[f.business,first.jobId]));assert.match(same,/"schemaVersion":\s*1\.000\b/);
});
test('missing, duplicate, foreign or broken internal records cannot be declared a successful source package',async()=>{
 for(const modify of [v=>v.rows.jobs.push(v.rows.jobs[0]),v=>v.rows.jobs[0].business_id=empty.business,v=>v.rows.jobs[0].current_appointment_id=randomUUID(),v=>v.rows.allocation_plan_parts[0].plan_id=randomUUID(),v=>v.expectedCounts.jobs='0']){const copy=structuredClone(snapshotData);modify(copy);assert.throws(()=>formatBookingSourceCsv(copy),/BOOKING_DATA_INVALID/);}
});
test('held source snapshot excludes a concurrent committed change and stale tokens cannot mix later sources',async()=>{
 await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');let captured;
 try{const initial=await context(f.business);const proposed=await schedule(f,scheduleRequest(second,lastSchedule.receipt.latestAppointmentId,'5'));assert.equal(proposed.state,'committed');captured=await collect(f.business);assert.equal(captured.snapshotToken,initial.snapshotToken);assert.equal(captured.expectedCounts.appointments,initial.expectedCounts.appointments);assert.equal(captured.rows.jobs.find(v=>v.id===second.jobId).version,'5');await exporter.query('COMMIT');}catch(e){await exporter.query('ROLLBACK');throw e;}
 const fresh=await snapshot(f.business);assert.notEqual(fresh.snapshotToken,captured.snapshotToken);assert.equal(fresh.rows.jobs.find(v=>v.id===second.jobId).version,'6');await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await assert.rejects(page(f.business,captured.snapshotToken,'jobs'),e=>e.code==='22023');await exporter.query('ROLLBACK');
});

test('booking history package links real retained receipts, released reservations, exact source images, actors, agreements and historical CRM',async()=>{
 await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{const source=await collect(f.business),foundation=await bookingFoundationEvidence(exporter,f.business),commercial=await bookingCommercialEvidence(exporter,f.business,foundation.history);closedSource={source,commercial,...foundation};await exporter.query('COMMIT');}catch(e){await exporter.query('ROLLBACK');throw e;}
 closedFiles=formatBookingSourceHistory(closedSource);const manifest=JSON.parse(closedFiles.manifest);
 assert.equal(manifest.includedBookingHistoryReferencesVerified,true);assert.equal(manifest.includedCommercialAssignmentsVerified,true);assert.equal(manifest.includedHistoricalCrmReferencesVerified,true);assert(manifest.bookingOperations>=8);assert(manifest.bookingAudits>manifest.bookingOperations);
 assert.equal(manifest.completePortableExport,false);assert.equal(manifest.completeBackup,false);assert.equal(manifest.consistentCaptureProven,false);assert.equal(manifest.referenceClosureComplete,false);
 assert(closedFiles.parts.some(p=>p.name==='jobs.csv'&&p.content.includes(first.jobId)));assert(closedFiles.parts.some(p=>p.name==='agreements.csv'));assert(closedFiles.parts.some(p=>p.name.startsWith('foundation_')&&p.content.includes('1.000')));
 assert(manifest.historicalCrmReferences.includes('customers:'+f.customer));assert(manifest.historicalCrmReferences.includes('vehicles:'+f.vehicle));
 for(const p of manifest.parts){const part=closedFiles.parts.find(v=>v.name===p.name);assert(part);assert.equal(Buffer.byteLength(part.content),p.bytes);assert.equal(createHash('sha256').update(part.content).digest('hex'),p.sha256);}
 assert.equal(new Set(closedFiles.parts.map(p=>p.name)).size,closedFiles.parts.length);assert.equal(closedFiles.parts.filter(p=>p.name==='operations.csv').length,1);
 for(const part of closedFiles.parts){assert(/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/.test(part.name),part.name);if(part.name.endsWith('_manifest.json')){const sub=JSON.parse(part.content);for(const p of sub.parts){const linked=closedFiles.parts.find(v=>v.name===p.name);assert(linked,part.name+' -> '+p.name);assert.equal(Buffer.byteLength(linked.content),p.bytes);assert.equal(createHash('sha256').update(linked.content).digest('hex'),p.sha256);}}}
});

test('a truthfully empty included booking domain composes without invented rows or a full-export claim',async()=>{
 await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');let input;
 try{const source=await collect(empty.business),foundation=await bookingFoundationEvidence(exporter,empty.business),commercial=await bookingCommercialEvidence(exporter,empty.business,foundation.history);input={source,commercial,...foundation};await exporter.query('COMMIT');}catch(e){await exporter.query('ROLLBACK');throw e;}
 const manifest=JSON.parse(formatBookingSourceHistory(input).manifest);assert.equal(manifest.bookingOperations,0);assert.equal(manifest.bookingAudits,0);assert.deepEqual(manifest.historicalCrmReferences,[]);assert.equal(manifest.completeBackup,false);
});

test('self-consistent source omission cannot hide retained booking, mode, appointment, partition or event history',()=>{
 for(const group of ['fulfillment_mode_versions','jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events']){
  const input=structuredClone(closedSource);assert(input.source.rows[group].length>0,group);input.source.rows[group].pop();input.source.expectedCounts[group]=String(input.source.rows[group].length);assert.throws(()=>formatBookingSourceHistory(input),undefined,group);
 }
 const erased=structuredClone(closedSource);for(const group of bookingRecordGroups){erased.source.rows[group]=[];erased.source.expectedCounts[group]='0';}assert.doesNotThrow(()=>formatBookingSourceCsv(erased.source));assert.throws(()=>formatBookingSourceHistory(erased));
});

test('altered retained snapshots, exact money, current heads and actor references cannot be exported as verified history',()=>{
 for(const modify of [
  x=>x.source.rows.jobs[0].updated_by=randomUUID(),
  x=>x.source.rows.job_vehicles[0].vehicle_snapshot=x.source.rows.job_vehicles[0].vehicle_snapshot.replace('Synthetic lifecycle sedan','A different vehicle'),
  x=>x.source.rows.allocation_plan_parts.find(p=>p.amount_cents!=='0').amount_cents='1',
  x=>x.source.rows.job_events[0].evidence=x.source.rows.job_events[0].evidence.replace('request','anotherRequest'),
  x=>x.source.rows.fulfillment_mode_versions[0].reason='Invented setup reason'
 ]){const input=structuredClone(closedSource);modify(input);assert.throws(()=>formatBookingSourceHistory(input));}
});

test('commercial/history/business snapshot tokens cannot be mixed into the booking package',()=>{
 for(const modify of [x=>x.source.historySnapshotToken='f'.repeat(64),x=>x.source.commercialSnapshotToken='f'.repeat(64),x=>x.commercial.historyEvidence=x.commercial.historyEvidence+' ',x=>x.commercial.businessId=empty.business]){const input=structuredClone(closedSource);modify(input);assert.throws(()=>formatBookingSourceHistory(input));}
});

test('missing agreement scope, original operation/audit records or actor profiles are not silently accepted',()=>{
 for(const modify of [
  x=>{x.commercial.rows.allocations.pop();x.commercial.expectedCounts.allocations=String(x.commercial.rows.allocations.length);},
  x=>{const h=JSON.parse(x.history);h.records=h.records.filter(r=>!(r.kind==='operation'&&JSON.parse(r.canonicalEvidence).row.command_type==='operations.job.book'));x.history=JSON.stringify(h);x.commercial.historyEvidence=x.history;},
  x=>{const h=JSON.parse(x.history);h.records=h.records.filter(r=>!(r.kind==='audit_event'&&JSON.parse(r.canonicalEvidence).row.entity_kind==='schedule_reservations'));x.history=JSON.stringify(h);x.commercial.historyEvidence=x.history;},
  x=>{const h=JSON.parse(x.identity);h.records=h.records.filter(r=>r.kind!=='actor'||r.recordId!==f.actor);x.identity=JSON.stringify(h);}
 ]){const input=structuredClone(closedSource);modify(input);assert.throws(()=>formatBookingSourceHistory(input));}
});

function replaceHistory(input,records){
 const h=JSON.parse(input.history);h.records=records;h.context.recordCounts={operation:String(records.filter(r=>r.kind==='operation').length),audit_event:String(records.filter(r=>r.kind==='audit_event').length)};h.evidenceBytes=records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0);input.history=JSON.stringify(h);input.commercial.historyEvidence=input.history;
}
function verifyOtherPackages(input){verifyBusinessFoundationEvidence(input.configuration,input.identity,input.history,{businessId:input.source.businessId});formatQuoteCommercialCsv(input.commercial);formatBookingSourceCsv(input.source);}

test('recounted plausible history omissions pass older packages but fail booking-specific cross-source closure',()=>{
 for(const kind of ['operations.job.book','released_reservations','historical_customer']){
  const input=structuredClone(closedSource),records=JSON.parse(input.history).records;
  const removedOperations=new Set(records.filter(r=>{const row=JSON.parse(r.canonicalEvidence).row;return kind==='operations.job.book'?r.kind==='operation'&&row.command_type===kind:kind==='historical_customer'&&r.kind==='audit_event'&&row.entity_kind==='customers';}).map(r=>JSON.parse(r.canonicalEvidence).row.operation_id));
  const kept=records.filter(r=>{const row=JSON.parse(r.canonicalEvidence).row;return !removedOperations.has(row.operation_id)&&!(kind==='released_reservations'&&r.kind==='audit_event'&&row.entity_kind==='schedule_reservations'&&row.action==='release');});assert(kept.length<records.length);replaceHistory(input,kept);assert.doesNotThrow(()=>verifyOtherPackages(input),kind);assert.throws(()=>formatBookingSourceHistory(input),undefined,kind);
 }
});

test('a separately valid empty commercial package cannot hide the accepted scope referenced by retained jobs',()=>{
 const input=structuredClone(closedSource);for(const group of Object.keys(input.commercial.rows)){input.commercial.rows[group]=[];input.commercial.expectedCounts[group]='0';}
 for(const [group,count]of [['families','expectedFamilyCount'],['revisions','expectedRevisionCount'],['items','expectedItemCount'],['assessments','expectedAssessmentCount'],['approvals','expectedApprovalCount']]){input.commercial.quotes[group]=[];input.commercial.quotes[count]='0';}
 assert.doesNotThrow(()=>verifyOtherPackages(input));assert.throws(()=>formatBookingSourceHistory(input));
});

test('rehashed operation evidence with changed receipt targets cannot authorize a false booking history package',()=>{
 for(const change of [r=>r.sourceAuditIds.pop(),r=>r.jobAuditEventId=randomUUID(),r=>r.appointmentId=randomUUID()]){
  const input=structuredClone(closedSource),records=JSON.parse(input.history).records,record=records.find(r=>r.kind==='operation'&&JSON.parse(r.canonicalEvidence).row.command_type==='operations.job.book');const evidence=JSON.parse(record.canonicalEvidence),receipt=JSON.parse(evidence.row.result);change(receipt);evidence.row.result=JSON.stringify(receipt);record.canonicalEvidence=JSON.stringify(evidence);record.evidenceHash=createHash('sha256').update(record.canonicalEvidence).digest('hex');replaceHistory(input,records);assert.doesNotThrow(()=>verifyOtherPackages(input));assert.throws(()=>formatBookingSourceHistory(input));
 }
 const input=structuredClone(closedSource),plan=input.source.rows.allocation_plan_versions.find(p=>input.source.rows.allocation_plan_parts.filter(v=>v.plan_id===p.id&&BigInt(v.amount_cents)>1n).length===2),parts=input.source.rows.allocation_plan_parts.filter(p=>p.plan_id===plan.id);for(const [index,p]of parts.entries())for(const field of ['gross_inclusive_cents','amount_cents'])p[field]=String(BigInt(p[field])+(index===0?1n:-1n));assert.doesNotThrow(()=>verifyOtherPackages(input));assert.throws(()=>formatBookingSourceHistory(input));
});

test('authorized address/relationship/transport snapshots remain linked to history after ordinary customer, vehicle and address edits',async()=>{
 const g=await fixture(),addressId=randomUUID(),associationId=randomUUID(),addressBody={line1:'123 Synthetic Lane',line2:null,city:'Indianapolis',region:'IN',postalCode:null,country:'US',exactLocationText:null,instructions:'Original synthetic access',latitude:null,longitude:null,geocodeSource:null,geocodeAccuracy:null,verifiedAt:null,archived:false,archiveReason:null};
 const saveAddress=body=>value(web,'SELECT crest_commands.save_address($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[...g.auth(),g.epoch,randomUUID(),addressId,g.customer,body===addressBody?'0':'1',body]);assert.equal((await saveAddress(addressBody)).state,'committed');
 assert.equal((await value(web,'SELECT crest_commands.change_vehicle_association($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,0,$11) AS value',[...g.auth(),g.epoch,randomUUID(),{action:'open',associationId,customerId:g.customer,vehicleId:g.vehicle,effectiveAt:'2026-10-01T00:00:00.000000Z',relationship:'owner',isBilling:true,evidence:null,reason:null,nextAssociationId:null}])).state,'committed');
 for(const seq of ['0','1'])assert.equal((await value(web,'SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) AS value',[...g.auth(),g.epoch,randomUUID(),seq,{mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:seq==='1',reason:seq==='0'?null:'Synthetic owner explicitly enabled pickup and return'}])).state,'committed');
 const address=await value(client,'SELECT crest_private.address_projection(a) AS value FROM crest.addresses a WHERE business_id=$1 AND id=$2',[g.business,addressId]),location={schemaVersion:1,kind:'customer_address',addressId,addressVersion:'1',snapshot:address},q=confirmedBookingRequest(g);q.expectedModeSequence='2';q.payload.fulfillmentMode='pickup_return';q.payload.workLocation=location;q.payload.vehicles[0].customerVehicleId=associationId;q.payload.vehicles[0].pickupLocation=location;q.payload.vehicles[0].returnLocation=location;assert.equal((await book(g,q)).state,'committed');
 assert.equal((await value(web,'SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) AS value',[...g.auth(),g.epoch,randomUUID(),g.customer,{displayName:'Synthetic later customer name',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}])).state,'committed');
 assert.equal((await value(web,'SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) AS value',[...g.auth(),g.epoch,randomUUID(),g.vehicle,{label:'Synthetic later vehicle label',year:2015,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null}])).state,'committed');assert.equal((await saveAddress({...addressBody,instructions:'Later synthetic access'})).state,'committed');
 await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');let input;
 try{const source=await collect(g.business),foundation=await bookingFoundationEvidence(exporter,g.business),commercial=await bookingCommercialEvidence(exporter,g.business,foundation.history);input={source,commercial,...foundation};await exporter.query('COMMIT');}catch(e){await exporter.query('ROLLBACK');throw e;}
 const result=formatBookingSourceHistory(input),m=JSON.parse(result.manifest);assert(m.historicalCrmReferences.includes('addresses:'+addressId));assert(m.historicalCrmReferences.includes('customer_vehicles:'+associationId));const saved=JSON.parse(input.source.rows.job_vehicles[0].customer_snapshot);assert.equal(saved.version,'1');assert.notEqual(saved.display_name,'Synthetic later customer name');
});
