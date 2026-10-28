// Schema/admin fixtures only. No genuine authentication or trusted save claim.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {prepareQuoteContent} from '../../src/commercial/quote-content.ts';
const sql=await readFile(new URL('../../planning/proposals/quote-draft-storage.sql',import.meta.url),'utf8');
const pricing=await readFile(new URL('../../planning/proposals/quote-pricing.sql',import.meta.url),'utf8');
const meta=JSON.parse(await readFile(new URL('../../planning/proposals/quote-draft-storage.json',import.meta.url),'utf8'));
let sandbox,client,target,bootstrap,a,b;
const scalar=async(query,parameters=[])=> (await client.query(query,parameters)).rows[0].value;
async function transaction(run){await client.query('BEGIN');try{const result=await run();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
async function claim(f,type='quote.draft.save'){
 const id=randomUUID();await client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,$4,1,$5,$6,$3,'manual')",[f.business,id,f.actor,type,f.epoch,'a'.repeat(64)]);return id;
}
const finish=(f,operation)=>client.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$3 WHERE business_id=$1 AND operation_id=$2",[f.business,operation,{schemaVersion:1,fixture:true}]);
const audit=(f,operation,kind,row,before=null)=>client.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,'manual')",[f.business,operation,f.actor,kind,row.id,row.version,before===null?'create':'edit',{schemaVersion:1,before,after:row}]);
const projection=(kind,id)=>{assert(['family','revision','item'].includes(kind));const table={family:'quote_families',revision:'quote_revisions',item:'quote_items'}[kind];return scalar('SELECT crest_private.quote_'+kind+'_projection(v) AS value FROM crest.'+table+' v WHERE id=$1',[id]);};
async function insert(table,values){assert(['quote_families','quote_revisions','quote_items'].includes(table));const keys=Object.keys(values);assert(keys.every(key=>/^[a-z_]+$/.test(key)));await client.query('INSERT INTO crest.'+table+'('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(values));}
async function state(){
 const subject=randomUUID(),actor=await scalar("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic quote owner','https://auth.example.com/auth/v1',$1,$2,$2,'manual') RETURNING id AS value",[subject,bootstrap]);
 const f=await transaction(async()=>{const business=await scalar("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic quote business','UTC',$1,$1,'manual') RETURNING id AS value",[actor]);await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=await scalar("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return {business,actor,epoch,subject};});
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);
 f.provider=randomUUID();f.session=randomUUID();f.hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[f.provider,subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[f.session,actor,f.provider,f.hash,randomBytes(32)]);
 f.customer=randomUUID();const saved=await scalar('SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS value',[f.hash,f.session,actor,'https://auth.example.com/auth/v1',subject,f.provider,new Date(Date.now()+300000),f.business,f.epoch,randomUUID(),1,f.customer,'0',{displayName:'Synthetic quote recipient',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}]);assert.equal(saved.state,'committed');return f;
}
const line=(grossCents)=>({id:randomUUID(),vehicleId:null,jobWide:true,vehicleLabel:null,serviceVersionId:null,description:'Synthetic job-wide work',inclusions:'Explicit synthetic scope',exclusions:'No exterior protection',condition:null,grossCents,lineDiscount:null,documentDiscountEligible:true,complimentaryReason:null});
const draft=f=>({schemaVersion:1,title:'Synthetic retained draft',recipient:{customerId:f.customer,leadId:null,displayName:'Synthetic quote recipient',phone:null,email:null},workLocation:'Synthetic workshop',terms:'',timezone:'UTC',expiryAt:null,proposedSchedule:null,internalNotes:'Private synthetic assumption',documentDiscount:{kind:'fixed',cents:'2500'},lines:[line('25000'),line('30000')]});
async function create(f,{input=draft(f),transform=x=>x,missing=null,type='quote.draft.save',hash=null}={}){
 return transaction(async()=>{
  const prepared=transform(structuredClone(prepareQuoteContent(input))),canonical=JSON.stringify({schemaVersion:1,customer:prepared.customer,internal:prepared.internal}),family=randomUUID(),revision=randomUUID(),operation=await claim(f,type),itemIds=[];
  const provenance={business_id:f.business,created_by:f.actor,updated_by:f.actor,origin:'manual',operation_id:operation};
  await insert('quote_families',{id:family,customer_id:prepared.internal.customerId,lead_id:prepared.internal.leadId,current_revision_id:revision,...provenance});
  await insert('quote_revisions',{id:revision,family_id:family,sequence:'1',customer_safe_snapshot:prepared.customer,internal_snapshot:prepared.internal,canonical_content:canonical,content_hash:hash??createHash('sha256').update(canonical).digest('hex'),total_cents:prepared.customer.totalCents,expiry_at:prepared.customer.expiryAt,timezone:prepared.customer.timezone,...provenance});
  for(const [index,row]of prepared.customer.lines.entries()){
   const source=prepared.internal.sources[index],id=randomUUID();itemIds.push(id);
   await insert('quote_items',{id,revision_id:revision,stable_line_key:source.stableLineKey,active:true,position:index+1,vehicle_id:source.vehicleId,job_wide:source.jobWide,service_version_id:source.serviceVersionId,gross_cents:row.grossCents,line_discount:JSON.stringify(row.lineDiscount),document_discount_eligible:row.documentDiscountEligible,line_discount_cents:row.lineDiscountCents,allocated_discount_cents:row.allocatedDiscountCents,final_cents:row.finalCents,complimentary_reason:row.complimentaryReason,customer_snapshot:row,...provenance});
   if(missing!=='items')await audit(f,operation,'quote_items',await projection('item',id));
  }
  if(missing!=='family')await audit(f,operation,'quote_families',await projection('family',family));
  if(missing!=='revision')await audit(f,operation,'quote_revisions',await projection('revision',revision));
  await finish(f,operation);return {family,revision,itemIds,input,prepared,operation};
 });
}
async function editNotes(f,record,notes){
 return transaction(async()=>{
  const oldFamily=await projection('family',record.family),oldRevision=await projection('revision',record.revision),operation=await claim(f),prepared=prepareQuoteContent({...record.input,internalNotes:notes});
  await client.query('UPDATE crest.quote_revisions SET version=version+1,content_version=content_version+1,customer_safe_snapshot=$2,internal_snapshot=$3,canonical_content=$4,content_hash=$5,operation_id=$6,updated_by=$7 WHERE id=$1',[record.revision,prepared.customer,prepared.internal,prepared.canonical,createHash('sha256').update(prepared.canonical).digest('hex'),operation,f.actor]);
  await client.query('UPDATE crest.quote_families SET version=version+1,operation_id=$2,updated_by=$3 WHERE id=$1',[record.family,operation,f.actor]);
  await audit(f,operation,'quote_families',await projection('family',record.family),oldFamily);await audit(f,operation,'quote_revisions',await projection('revision',record.revision),oldRevision);await finish(f,operation);return prepared;
 });
}
async function evidence(f){return scalar("SELECT jsonb_build_object('families',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.quote_families v WHERE business_id=$1),'revisions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.quote_revisions v WHERE business_id=$1),'items',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.quote_items v WHERE business_id=$1),'operations',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest_private.operations v WHERE business_id=$1),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest_private.audit_events v WHERE business_id=$1)) AS value",[f.business]);}
async function refused(run){const before=await evidence(a);await assert.rejects(run);assert.deepEqual(await evidence(a),before);}
before(async()=>{
 assert.equal(meta.registered,false);assert.equal(meta.runtimeEnabled,false);assert.equal(meta.existingMigrationCount,44);assert.equal(Buffer.byteLength(sql),meta.sqlBytes);assert.equal(createHash('sha256').update(sql).digest('hex'),meta.sqlSha256);
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);await sandbox.apply(target);
 await transaction(()=>client.query(pricing));await transaction(()=>client.query(sql));
 // The harness refused all these roles before provisioning. Observe the newly
 // created closed quote role through the established ownership collector.
 await sandbox.apply(target);bootstrap=await scalar("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");a=await state();b=await state();
},{timeout:240000});
after(async()=>{await sandbox?.close();});
test('three forced-RLS tables and private helpers stay closed to web, worker and export roles',async()=>{
 for(const table of ['quote_families','quote_revisions','quote_items']){
  assert.equal(await scalar("SELECT relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole AS value FROM pg_class WHERE oid=$1::regclass",['crest.'+table]),true);
  for(const role of ['crest_web','crest_worker','crest_export'])assert.equal(await scalar("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS value",[role,'crest.'+table]),false);
 }
 assert.equal(await scalar("SELECT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls AS value FROM pg_roles WHERE rolname='crest_quote_integrity_owner'"),false);
});
test('a complete typed Draft retains exact52500 cents, private/public snapshots and immutable audit images',async()=>{
 const record=await create(a),revision=await projection('revision',record.revision);assert.equal(revision.total_cents,'52500');assert.equal(revision.state,'Draft');assert.equal(revision.content_version,'1');assert.deepEqual(revision.customer_safe_snapshot,record.prepared.customer);assert.deepEqual(revision.internal_snapshot,record.prepared.internal);
 assert.equal(await scalar("SELECT count(*)::int AS value FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2",[a.business,record.operation]),4);
 const next=await editNotes(a,record,'Changed synthetic assumption');assert.equal((await projection('revision',record.revision)).content_version,'2');assert.equal((await projection('family',record.family)).version,'2');
 assert.equal(await scalar("SELECT delta->'after'->'internal_snapshot'->>'notes' AS value FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='quote_revisions' AND entity_id=$2 AND entity_version=1",[a.business,record.revision]),record.input.internalNotes);assert.equal((await projection('revision',record.revision)).canonical_content,next.canonical);
});
for(const missing of ['family','revision','items'])test('missing '+missing+' audit rolls back the complete transaction',()=>refused(()=>create(a,{missing})));
test('a mismatched command type cannot publish a draft through forged schema fixtures',()=>refused(()=>create(a,{type:'catalog.service.save'})));
test('cross-business recipient references fail before retaining a family or operation',()=>refused(()=>create(a,{input:{...draft(a),recipient:{customerId:b.customer,leadId:null,displayName:'Synthetic foreign recipient',phone:null,email:null}}})));
test('the content hash cannot disagree with exact retained serialization',()=>refused(()=>create(a,{hash:'0'.repeat(64)})));
for(const [name,transform]of [
 ['wrong total',p=>({...p,customer:{...p.customer,totalCents:'1'}})],
 ['wrong discount share',p=>({...p,customer:{...p.customer,lines:p.customer.lines.map((row,i)=>i===0?{...row,allocatedDiscountCents:'1135',finalCents:'23865'}:row)}})],
 ['unreviewed Extreme flag',p=>({...p,internal:{...p.internal,extremeReviewRequired:true}})],
 ['private field in customer snapshot',p=>({...p,customer:{...p.customer,internalNotes:'Must not be exposed'}})],
 ['untyped customer field',p=>({...p,customer:{...p.customer,recipient:{...p.customer.recipient,privateSource:'Must not be exposed'}}})]
])test('rejects '+name+' even with a matching newly computed hash',()=>refused(()=>create(a,{transform})));
test('explicit free work retains a reason without a fabricated charge or payment',async()=>{
 const record=await create(a,{input:{...draft(a),documentDiscount:null,lines:[{...line('0'),complimentaryReason:'Synthetic goodwill'}]}});assert.equal((await projection('revision',record.revision)).total_cents,'0');
});
test('line writes without a corresponding actual revision publication cannot commit',async()=>{
 const record=await create(a);await refused(()=>transaction(async()=>{const operation=await claim(a),old=await projection('item',record.itemIds[0]);await client.query('UPDATE crest.quote_items SET version=version+1,operation_id=$2 WHERE id=$1',[record.itemIds[0],operation]);await audit(a,operation,'quote_items',await projection('item',record.itemIds[0]),old);await finish(a,operation);}));
});
test('Draft-only construction refuses premature sending, approval state or tax activation',async()=>{
 const record=await create(a);for(const patch of ["state='Sent'","state='Accepted'","tax_readiness='ready'"])await refused(()=>transaction(()=>client.query('UPDATE crest.quote_revisions SET '+patch+',version=version+1 WHERE id=$1',[record.revision])));
});
test('deletion and truncation cannot erase quote roots, revisions or removed-line history',async()=>{
 const record=await create(a);for(const [table,id]of [['quote_families',record.family],['quote_revisions',record.revision],['quote_items',record.itemIds[0]]]){
  await refused(()=>transaction(()=>client.query('DELETE FROM crest.'+table+' WHERE id=$1',[id])));await refused(()=>transaction(()=>client.query('TRUNCATE crest.'+table+' CASCADE')));
 }
});
