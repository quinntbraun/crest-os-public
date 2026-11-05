// Actual disposable registered51 plus an unregistered storage proposal.
// Synthetic SQL authority; no genuine MFA, application admission or acceptance.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
let sandbox,client,web,login,accepted,legacy,beforeRows,beforeProjection;
const proposal=await readFile(new URL('../../planning/proposals/quote-amendment-storage.sql',import.meta.url),'utf8');
const tables=['crest.quote_families','crest.quote_revisions','crest.quote_items','crest.condition_assessments','crest.quote_approvals','crest.quote_family_commercial_state','crest.quote_sends','crest.quote_acceptances','crest.agreements','crest.scope_entitlements','crest.entitlement_versions','crest.scope_allocations','crest_private.operations','crest_private.audit_events'];
async function sources(business){const result={};for(const table of tables){const image=table==='crest.quote_revisions'?"to_jsonb(r)-'parent_agreement_id'":'to_jsonb(r)';result[table]=(await client.query('SELECT ('+image+')::text AS value FROM '+table+' r WHERE business_id=$1 ORDER BY ('+image+')::text COLLATE "C"',[business])).rows.map(row=>row.value);}return result;}
async function rollback(work){await client.query('BEGIN');try{return await work();}finally{await client.query('ROLLBACK');}}
const scalar=(sql,args=[])=>client.query(sql,args).then(result=>result.rows[0].value);
before(async()=>{
 sandbox=await migrationSandbox();const target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);assert.equal((await sandbox.apply(target,await sandbox.prefix(51))).history.length,51);
 const bootstrap=await scalar("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");login='crest_amendment_storage_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());await web.query('SET ROLE crest_web');accepted=createConfirmedBookingFixture({client,web,bootstrap});legacy=await accepted();beforeRows=await sources(legacy.business);beforeProjection=await scalar('SELECT crest_private.quote_revision_projection(r)::text AS value FROM crest.quote_revisions r WHERE business_id=$1 AND family_id=$2',[legacy.business,legacy.familyId]);
 await client.query('BEGIN');try{await client.query(proposal);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
},{timeout:240000});
after(async()=>{await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});

test('preserves all prior commercial source fields, accepted preimage, original operations and audit images',async()=>{
 assert.deepEqual(await sources(legacy.business),beforeRows);assert.equal(await scalar('SELECT crest_private.quote_revision_projection(r)::text AS value FROM crest.quote_revisions r WHERE business_id=$1 AND family_id=$2',[legacy.business,legacy.familyId]),beforeProjection);
 assert.equal(await scalar("SELECT parent_agreement_id IS NULL AS value FROM crest.quote_revisions WHERE business_id=$1 AND family_id=$2",[legacy.business,legacy.familyId]),true);
});
test('retains actual initial Draft/review/approval/share/acceptance after adding parent storage',async()=>{
 const next=await accepted();assert.notEqual(next.agreementId,legacy.agreementId);assert.equal(next.sources.length,2);assert(next.sources.some(row=>row.amount_cents==='0'));assert.deepEqual(await sources(legacy.business),beforeRows);
});
test('retains forced RLS, closed roles and no new browser/worker execution or schema-create privilege',async()=>{
 const relations=(await client.query("SELECT relrowsecurity,relforcerowsecurity,relowner='crest_schema_owner'::regrole AS owned FROM pg_class WHERE oid IN('crest.agreements'::regclass,'crest.quote_revisions'::regclass)")).rows;assert.equal(relations.length,2);assert(relations.every(row=>row.relrowsecurity&&row.relforcerowsecurity&&row.owned));
 for(const role of ['crest_web','crest_worker','crest_recovery'])for(const signature of ['crest_private.agreement_successor_valid(crest.agreements,crest.agreements)','crest_private.check_agreement_successor()','crest_private.retain_quote_amendment_parent()'])assert.equal(await scalar('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS value',[role,signature]),false);
 assert.equal(await scalar("SELECT has_schema_privilege('crest_quote_integrity_owner','crest_private','CREATE') AS value"),false);
 assert.equal(await scalar("SELECT count(*)::int AS value FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole)"),0);
});
test('binds a deferred enabled successor guard and same-family/customer parent and single-successor constraints',async()=>{
 const trigger=(await client.query("SELECT tgenabled,tgdeferrable,tginitdeferred,tgconstraint<>0 AS constrained FROM pg_trigger WHERE tgrelid='crest.agreements'::regclass AND tgname='agreement_successor_integrity'")).rows[0];assert.deepEqual(trigger,{tgenabled:'O',tgdeferrable:true,tginitdeferred:true,constrained:true});
 const constraints=(await client.query("SELECT conname,contype,convalidated FROM pg_constraint WHERE conrelid='crest.agreements'::regclass AND conname IN('agreement_parent_same_family_customer','agreement_one_successor') ORDER BY conname")).rows;assert.deepEqual(constraints,[{conname:'agreement_one_successor',contype:'u',convalidated:true},{conname:'agreement_parent_same_family_customer',contype:'f',convalidated:true}]);
 assert.equal(await scalar("SELECT pg_get_constraintdef(oid) AS value FROM pg_constraint WHERE conrelid='crest.quote_revisions'::regclass AND conname='quote_revisions_kind_check'"),"CHECK ((kind = ANY (ARRAY['initial'::text, 'amendment'::text])))");
});
const base=()=>({id:randomUUID(),business_id:randomUUID(),family_id:randomUUID(),customer_id:randomUUID(),version_no:'1',parent_agreement_id:null,total_cents:'25000',signed_delta_cents:'25000'});
const successor=(parent,patch={})=>({...parent,id:randomUUID(),version_no:(BigInt(parent.version_no)+1n).toString(),parent_agreement_id:parent.id,signed_delta_cents:'0',...patch});
async function valid(row,parent=null){return scalar('SELECT crest_private.agreement_successor_valid(jsonb_populate_record(NULL::crest.agreements,$1::jsonb),jsonb_populate_record(NULL::crest.agreements,$2::jsonb)) AS value',[JSON.stringify(row),parent===null?null:JSON.stringify(parent)]);}
test('validates initial, positive, negative, zero and exact large-cent successors against PostgreSQL arithmetic',async()=>{
 const parent=base();assert.equal(await valid(parent),true);for(const total of ['0','10000','25000','27001','9223372036854775807'])assert.equal(await valid(successor(parent,{total_cents:total,signed_delta_cents:(BigInt(total)-25000n).toString()}),parent),true);
 const large={...parent,total_cents:'9223372036854775807',signed_delta_cents:'9223372036854775807'};assert.equal(await valid(successor(large,{total_cents:'0',signed_delta_cents:'-9223372036854775807'}),large),true);
});
for(const [name,patch]of [
 ['wrong business',row=>({...row,business_id:randomUUID()})],['wrong family',row=>({...row,family_id:randomUUID()})],['wrong customer',row=>({...row,customer_id:randomUUID()})],['wrong parent ID',row=>({...row,parent_agreement_id:randomUUID()})],['skipped version',row=>({...row,version_no:'3'})],['incorrect delta',row=>({...row,signed_delta_cents:'1'})],['self parent',row=>({...row,id:row.parent_agreement_id})],['negative total',row=>({...row,total_cents:'-1',signed_delta_cents:'-25001'})],['missing customer',row=>({...row,customer_id:null})],['null version',row=>({...row,version_no:null})]
])test('refuses '+name+' without treating missing values as a valid chain',async()=>{const parent=base();assert.equal(await valid(patch(successor(parent)),parent),false);});
test('refuses absent parents, forged initial delta, noninitial roots and bigint version overflow',async()=>{
 const parent=base();assert.equal(await valid(successor(parent)),false);assert.equal(await valid({...parent,signed_delta_cents:'0'}),false);assert.equal(await valid({...parent,version_no:'2'}),false);const last={...parent,version_no:'9223372036854775807'};assert.equal(await valid({...successor(parent),version_no:'9223372036854775807'},last),false);assert.equal(await valid(parent,parent),false);
});
async function insertRevision(patch={}){
 const id=randomUUID(),sequence=await scalar('SELECT (max(sequence)+1)::text AS value FROM crest.quote_revisions WHERE business_id=$1 AND family_id=$2',[legacy.business,legacy.familyId]);
 return client.query("INSERT INTO crest.quote_revisions SELECT (jsonb_populate_record(NULL::crest.quote_revisions,to_jsonb(r)||$3::jsonb)).* FROM crest.quote_revisions r WHERE business_id=$1 AND family_id=$2 RETURNING id",[legacy.business,legacy.familyId,JSON.stringify({id,sequence,kind:'amendment',parent_agreement_id:legacy.agreementId,state:'Draft',version:'1',content_version:'1',...patch})]);
}
test('admits a parent-bound provisional amendment row and explicit parent projection without accepting or committing it',async()=>{
 await rollback(async()=>{const row=(await insertRevision()).rows[0];const projection=await scalar('SELECT crest_private.quote_revision_projection(r) AS value FROM crest.quote_revisions r WHERE id=$1',[row.id]);assert.equal(projection.parent_agreement_id,legacy.agreementId);assert.equal(projection.kind,'amendment');assert.equal(projection.state,'Draft');});assert.deepEqual(await sources(legacy.business),beforeRows);
});
test('rejects a second open amendment Draft with the actual unique index',async()=>{
 await rollback(async()=>{await insertRevision();await assert.rejects(insertRevision(),error=>error.code==='23505'&&error.constraint==='quote_one_open_amendment_draft');});
});
for(const [name,patch,constraint]of [['amendment without parent',{parent_agreement_id:null},'quote_amendment_parent_shape'],['initial with parent',{kind:'initial'},'quote_amendment_parent_shape'],['unknown kind',{kind:'change'},'quote_amendment_parent_shape'],['missing parent',{parent_agreement_id:randomUUID()},'quote_amendment_parent_same_family']])test('rejects '+name+' using its actual database constraint',async()=>{
 await rollback(async()=>{await assert.rejects(insertRevision(patch),error=>error.constraint===constraint);});
});
test('retains parent/kind on existing revisions and refuses duplicate proposal installation without rewriting sources',async()=>{
 for(const set of ['parent_agreement_id=$3','kind=\'amendment\''])await assert.rejects(client.query('UPDATE crest.quote_revisions SET '+set+' WHERE business_id=$1 AND family_id=$2',[legacy.business,legacy.familyId,...set.includes('$3')?[legacy.agreementId]:[]]),error=>error.code==='23514'&&error.message==='CREST_AMENDMENT_PARENT_RETAINED');
 await rollback(async()=>{await assert.rejects(client.query(proposal),error=>error.code==='42501'&&error.message==='CREST_AMENDMENT_STORAGE_SOURCE_REVIEW_REQUIRED');});assert.deepEqual(await sources(legacy.business),beforeRows);
});
