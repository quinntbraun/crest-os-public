// Native isolated 40 -> UNREGISTERED proposal41. No production migration path.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {leadConversionProposal} from '../support/lead-conversion-proposal.mjs';
let sandbox,client,target,web,web2,login,bootstrap,prior,receipt,proposal,guardRefused=false;
const issuer='https://auth.example.com/auth/v1';
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const addressDraft=(patch={})=>({line1:null,line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:null,instructions:null,latitude:null,longitude:null,geocodeSource:null,geocodeAccuracy:null,verifiedAt:null,archived:false,archiveReason:null,...patch});
const vehicleDraft=(patch={})=>({label:'Explicit directory vehicle',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null,...patch});
const customerDraft=(patch={})=>({displayName:'Explicit customer 😀',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null,...patch});
const newTarget=draft=>({kind:'new',id:randomUUID(),draft});
const existingTarget=(id,expectedVersion='1')=>({kind:'existing',id,expectedVersion});
const request=(lead,patch={})=>({lead,id:randomUUID(),version:'1',operation:randomUUID(),body:{customer:newTarget(customerDraft()),vehicles:[],addresses:[]},...patch});
const convert=(f,r,c=web)=>c.query('SELECT crest_commands.convert_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[...auth(f),f.epoch,r.operation,r.id,r.lead,r.version,r.body]).then(r=>r.rows[0].value);
const lookup=(f,id)=>web.query('SELECT crest_commands.lookup_lead_conversion_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),id]).then(r=>r.rows[0].value);
async function session(f){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
 return {...f,provider,session,hash};
}
async function state(){
 const subject=randomUUID(),actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic conversion owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
 await client.query('BEGIN');let business,epoch;
 try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic conversion business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);return session({business,epoch,subject,actor});
}
async function lead(f,patch={}){
 const id=randomUUID(),draft={label:'Synthetic incomplete lead',customerId:null,sourceId:null,referralText:'  Original referral 😀  ',phone:null,email:null,requestedScope:'Reported request; not accepted',availability:null,estimatedCents:'123456',followUpAt:'2026-10-25T01:02:03.123456Z',notes:'Original lead notes '+ 'é'.repeat(2100),...patch};
 const save=async(version='0',body=draft)=>(await web.query('SELECT crest_commands.save_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...auth(f),f.epoch,randomUUID(),id,version,body])).rows[0].value;
 assert.equal((await save()).state,'committed');return {id,draft,save};
}
async function report(f,parent,role,patch={}){
 const id=randomUUID(),draft=role==='vehicle'?{vehicleId:null,reportedVehicle:{schemaVersion:1,label:'Raw reported vehicle 😀',year:1899,make:'  Original make  ',model:null,color:null,vin:' raw invalid vin ',plate:null,notes:null},requestedServices:{schemaVersion:1,text:'Original request only'},conditionNotes:'Original condition',archived:false,archiveReason:null,...patch}:addressDraft(patch);
 const save=async(version='0',body=draft)=>(await web.query(`SELECT crest_commands.save_lead_${role}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value`,[...auth(f),f.epoch,randomUUID(),parent,id,version,body])).rows[0].value;
 assert.equal((await save()).state,'committed');return {id,draft,save};
}
async function directory(f,role,draft,parent=null){
 const id=randomUUID();const save=async(version='0',body=draft)=>(await web.query(`SELECT crest_commands.save_${role}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,${role==='address'?'$12,$13,$14':'$12,$13'}) AS value`,[...auth(f),f.epoch,randomUUID(),id,...(role==='address'?[parent]:[]),version,body])).rows[0].value;
 assert.equal((await save()).state,'committed');return {id,draft,save};
}
const vehicleLink=(source,target=newTarget(vehicleDraft()))=>({linkId:randomUUID(),leadVehicleId:source.id,expectedLeadVehicleVersion:'1',target});
const addressLink=(source,target=newTarget(addressDraft()))=>({linkId:randomUUID(),leadAddressId:source.id,expectedLeadAddressVersion:'1',target});
async function evidence(f){const out={};for(const table of ['crest.leads','crest.lead_vehicles','crest.lead_addresses','crest.customers','crest.vehicles','crest.addresses','crest.customer_vehicles','crest.lead_conversions','crest.conversion_links','crest_private.operations','crest_private.audit_events'])out[table]=(await client.query(`SELECT to_jsonb(v) AS value FROM ${table} v WHERE business_id=$1 ORDER BY id`,[f.business])).rows;return out;}
const activity=f=>client.query('SELECT to_jsonb(v) AS value FROM crest_private.app_sessions v WHERE id=$1',[f.session]).then(r=>r.rows);
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);proposal=await leadConversionProposal(sandbox);prior=await sandbox.apply(target,proposal.prefix);
 const guard=await sandbox.database(),guardClient=await sandbox.connect(guard);await sandbox.apply(guard,await sandbox.prefix(0),true);await installProviderSchema(guardClient,guard);await sandbox.apply(guard,proposal.prefix);
 await client.query('ALTER ROLE crest_lead_owner LOGIN');try{await assert.rejects(sandbox.apply(guard,proposal.directory),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await guardClient.query("SELECT to_regclass('crest.lead_conversions') AS value")).rows[0].value,null);guardRefused=true;}finally{await client.query('ALTER ROLE crest_lead_owner NOLOGIN');}
 receipt=await sandbox.apply(target,proposal.directory);bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
 login='crest_conversion_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());web2=await sandbox.connect(url.toString());for(const c of [web,web2]){await c.query('SET ROLE crest_web');await c.query("SET lock_timeout='3s'");}
},{timeout:240000});
after(async()=>{await web?.end();await web2?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});

test('proposal41 preserves the registered40 history, rejects unsafe owners and reapplies idempotently',async()=>{assert(guardRefused);assert.equal(prior.history.length,40);assert.equal(receipt.history.length,41);assert.deepEqual(receipt.history.slice(0,40),prior.history);assert.deepEqual((await sandbox.apply(target,proposal.directory)).history,receipt.history);});
test('SQL child operation identities match independent SHA256 vectors for all four roles',async()=>{
 const expected={customer:'9a4707b1-a8f7-8bbe-9de1-85fca8a7dfac',vehicle:'8ce78a8f-200d-8a49-8c5c-77ea91cdaa1a',address:'58be4bb7-5ccc-8612-974f-c8da37952da8',lead:'face5a0f-2ebb-8398-8098-f697898669e4'};
 for(const [role,id] of Object.entries(expected))assert.equal((await client.query('SELECT crest_private.conversion_child_operation($1,$2,$3,$4,$5) AS id',['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',role,'44444444-4444-4444-8444-444444444444'])).rows[0].id,id);
});
test('new customer, two vehicles and two locations commit together without altering intake, ownership or outcome',async()=>{
 const f=await state(),parent=await lead(f),v1=await report(f,parent.id,'vehicle'),v2=await report(f,parent.id,'vehicle'),a1=await report(f,parent.id,'address'),a2=await report(f,parent.id,'address');
 const r=request(parent.id),precise=addressDraft({line1:'',exactLocationText:'  Behind barn 😀\nOriginal  ',latitude:'-0.00000000000000000000',longitude:'180.00000000000000000000',verifiedAt:'2026-10-25T01:02:03.123456Z'});r.body.vehicles=[vehicleLink(v1,newTarget(vehicleDraft({year:1899,vin:' raw invalid vin '}))),vehicleLink(v2)];r.body.addresses=[addressLink(a1,newTarget(precise)),addressLink(a2)];
 const before=await evidence(f),first=await convert(f,r);assert.equal(first.state,'committed');assert.deepEqual(await lookup(f,r.operation),first);assert.deepEqual(await convert(f,r),first);
 const after=await evidence(f);for(const table of ['crest.lead_vehicles','crest.lead_addresses','crest.customer_vehicles'])assert.deepEqual(after[table],before[table]);assert.equal(after['crest.customers'].length,1);assert.equal(after['crest.vehicles'].length,2);assert.equal(after['crest.addresses'].length,2);assert.equal(after['crest.lead_conversions'].length,1);assert.equal(after['crest.conversion_links'].length,4);
 const original=before['crest.leads'][0].value,current=after['crest.leads'][0].value;for(const key of Object.keys(original).filter(k=>!['customer_id','version','updated_at','updated_by','operation_id'].includes(k)))assert.deepEqual(current[key],original[key]);assert.equal(current.state,'new');assert.equal(current.customer_id,r.body.customer.id);
 assert.equal(after['crest_private.operations'].length-before['crest_private.operations'].length,7);assert.equal(after['crest_private.audit_events'].length-before['crest_private.audit_events'].length,11);
 const address=(await client.query('SELECT crest_private.address_projection(v) AS value FROM crest.addresses v WHERE id=$1',[r.body.addresses[0].target.id])).rows[0].value;assert.equal(address.latitude,'0.00000000000000000000');assert.equal(address.longitude,precise.longitude);assert.equal(address.verified_at,precise.verifiedAt);assert.equal(address.line1,'');assert.equal(address.exact_location_text,precise.exactLocationText);
});
test('existing destinations support explicit many-to-one mapping without directory updates',async()=>{
 const f=await state(),customer=await directory(f,'customer',customerDraft()),vehicle=await directory(f,'vehicle',vehicleDraft()),address=await directory(f,'address',addressDraft(),customer.id),parent=await lead(f,{customerId:customer.id});const v1=await report(f,parent.id,'vehicle'),v2=await report(f,parent.id,'vehicle'),a1=await report(f,parent.id,'address'),a2=await report(f,parent.id,'address');
 const r=request(parent.id,{body:{customer:existingTarget(customer.id),vehicles:[vehicleLink(v1,existingTarget(vehicle.id)),vehicleLink(v2,existingTarget(vehicle.id))],addresses:[addressLink(a1,existingTarget(address.id)),addressLink(a2,existingTarget(address.id))]}}),before=await evidence(f);assert.equal((await convert(f,r)).state,'committed');const after=await evidence(f);for(const table of ['crest.customers','crest.vehicles','crest.addresses','crest.customer_vehicles'])assert.deepEqual(after[table],before[table]);assert.equal(after['crest_private.operations'].length-before['crest_private.operations'].length,2);assert.equal(after['crest.conversion_links'].length,4);
});
test('original receipt survives later directory, intake and source edits; changed requests cannot reuse its identity',async()=>{
 const f=await state(),customer=await directory(f,'customer',customerDraft()),vehicle=await directory(f,'vehicle',vehicleDraft()),address=await directory(f,'address',addressDraft(),customer.id),parent=await lead(f),v=await report(f,parent.id,'vehicle'),a=await report(f,parent.id,'address');
 const r=request(parent.id,{body:{customer:existingTarget(customer.id),vehicles:[vehicleLink(v,existingTarget(vehicle.id))],addresses:[addressLink(a,existingTarget(address.id))]}}),first=await convert(f,r);assert.equal(first.state,'committed');
 assert.equal((await customer.save('1',customerDraft({notes:'Later directory note'}))).state,'committed');assert.equal((await vehicle.save('1',vehicleDraft({label:'Later directory label'}))).state,'committed');assert.equal((await address.save('1',addressDraft({instructions:'Later directory directions'}))).state,'committed');assert.equal((await v.save('1',{...v.draft,conditionNotes:'Later report'})).state,'committed');assert.equal((await a.save('1',addressDraft({instructions:'Later intake location'}))).state,'committed');assert.equal((await parent.save('2',{...parent.draft,customerId:customer.id,notes:'Later retained lead note'})).state,'committed');
 const retained=await evidence(f);assert.deepEqual(await lookup(f,r.operation),first);assert.deepEqual(await convert(f,r),first);
 for(const changed of [{...r,id:randomUUID()},{...r,version:'2'},{...r,body:{...r.body,vehicles:[]}},{...r,body:{...r.body,addresses:[{...r.body.addresses[0],linkId:randomUUID()}]}}])assert.deepEqual(await convert(f,changed),{state:'conflict',reason:'operation'});assert.deepEqual(await evidence(f),retained);
});
test('second conversion, stale lead and customer reassignment leave no losing claims',async()=>{
 const f=await state(),parent=await lead(f),r=request(parent.id);assert.equal((await convert(f,r)).state,'committed');const retained=await evidence(f);
 assert.deepEqual(await convert(f,{...r,operation:randomUUID()}),{state:'conflict',reason:'lead'});
 const second={...r,id:randomUUID(),operation:randomUUID(),version:'2'};assert.deepEqual(await convert(f,second),{state:'conflict',reason:'conversion'});assert.deepEqual(await lookup(f,second.operation),{state:'absent'});
 await assert.rejects(parent.save('2',{...parent.draft,customerId:null}),e=>e.code==='55000');assert.deepEqual(await evidence(f),retained);
});
test('malformed selection, duplicate sources/links and oversized requests cannot claim operations',async()=>{
 const f=await state(),parent=await lead(f),r=request(parent.id),source=await report(f,parent.id,'vehicle'),one=vehicleLink(source),a=await report(f,parent.id,'address');
 for(const body of [null,{},[],{...r.body,unknown:true},{...r.body,customer:{...r.body.customer,expectedVersion:'1'}},{...r.body,vehicles:[one,{...one,linkId:randomUUID()}]},{...r.body,vehicles:[one],addresses:[{...addressLink(a),linkId:one.linkId}]},{...r.body,vehicles:[{...one,expectedLeadVehicleVersion:'0'}]},{...r.body,customer:newTarget(customerDraft({notes:'😀'.repeat(40000)}))}]){const retained=await evidence(f);await assert.rejects(convert(f,{...r,body}),e=>e.code==='22023');assert.deepEqual(await evidence(f),retained);}
});
test('missing, cross-business, wrong-parent, archived and stale source versions roll back completely',async()=>{
 const f=await state(),foreign=await state(),parent=await lead(f),other=await lead(f),outside=await lead(foreign),v=await report(f,parent.id,'vehicle'),wrong=await report(f,other.id,'vehicle'),cross=await report(foreign,outside.id,'vehicle'),archived=await report(f,parent.id,'vehicle',{archived:true,archiveReason:'Owner archived'});
 for(const source of [{id:randomUUID()},wrong,cross,archived]){const r=request(parent.id);r.body.vehicles=[vehicleLink(source)];const retained=await evidence(f);assert.deepEqual(await convert(f,r),{state:'conflict',reason:'source'});assert.deepEqual(await lookup(f,r.operation),{state:'absent'});assert.deepEqual(await evidence(f),retained);}
 const r=request(parent.id);r.body.vehicles=[{...vehicleLink(v),expectedLeadVehicleVersion:'2'}];const retained=await evidence(f);assert.deepEqual(await convert(f,r),{state:'conflict',reason:'source'});assert.deepEqual(await evidence(f),retained);
});
test('stale, missing, foreign and wrong-customer destinations cannot be overwritten or reparented',async()=>{
 const f=await state(),foreign=await state(),parent=await lead(f),customer=await directory(f,'customer',customerDraft()),other=await directory(f,'customer',customerDraft()),outside=await directory(foreign,'customer',customerDraft()),address=await directory(f,'address',addressDraft(),other.id),a=await report(f,parent.id,'address');
 const selections=[{customer:existingTarget(randomUUID()),vehicles:[],addresses:[]},{customer:existingTarget(outside.id),vehicles:[],addresses:[]},{customer:existingTarget(customer.id,'2'),vehicles:[],addresses:[]},{customer:existingTarget(customer.id),vehicles:[],addresses:[addressLink(a,existingTarget(address.id))]}];
 for(const body of selections){const r=request(parent.id,{body}),retained=await evidence(f);assert.deepEqual(await convert(f,r),{state:'conflict',reason:'destination'});assert.deepEqual(await lookup(f,r.operation),{state:'absent'});assert.deepEqual(await evidence(f),retained);}
 const linked=await lead(f,{customerId:customer.id}),r=request(linked.id);const retained=await evidence(f);assert.deepEqual(await convert(f,r),{state:'conflict',reason:'destination'});assert.deepEqual(await evidence(f),retained);
});
test('a malformed late address child rolls back the earlier customer and vehicle children and activity',async()=>{
 const f=await state(),parent=await lead(f),v=await report(f,parent.id,'vehicle'),a=await report(f,parent.id,'address'),r=request(parent.id);r.body.vehicles=[vehicleLink(v)];r.body.addresses=[addressLink(a,newTarget(addressDraft({latitude:'91',longitude:'0'})))];
 const retained=await evidence(f),stamp=await activity(f);await assert.rejects(convert(f,r),e=>e.code==='22023');assert.deepEqual(await evidence(f),retained);assert.deepEqual(await activity(f),stamp);assert.deepEqual(await lookup(f,r.operation),{state:'absent'});
});
test('a separately committed child identity cannot be adopted as a fresh conversion creation',async()=>{
 const f=await state(),parent=await lead(f),r=request(parent.id),child=(await client.query('SELECT crest_private.conversion_child_operation($1,$2,$3,$4,$5) AS id',[f.business,r.operation,r.id,'customer',r.body.customer.id])).rows[0].id;
 assert.equal((await web.query('SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS value',[...auth(f),f.epoch,child,r.body.customer.id,r.body.customer.draft])).rows[0].value.state,'committed');const retained=await evidence(f),stamp=await activity(f);assert.deepEqual(await convert(f,r),{state:'conflict',reason:'operation'});assert.deepEqual(await evidence(f),retained);assert.deepEqual(await activity(f),stamp);assert.deepEqual(await lookup(f,r.operation),{state:'absent'});
});
test('root audit refusal and final activity refusal roll back every child, mapping and original lead change',async()=>{
 const f=await state(),parent=await lead(f),v=await report(f,parent.id,'vehicle'),r=request(parent.id);r.body.vehicles=[vehicleLink(v)];const retained=await evidence(f),stamp=await activity(f);
 await client.query("ALTER TABLE crest_private.audit_events ADD CONSTRAINT synthetic_conversion_refusal CHECK(entity_kind<>'lead_conversions') NOT VALID");try{await assert.rejects(convert(f,r),e=>e.code==='23514');assert.deepEqual(await evidence(f),retained);assert.deepEqual(await activity(f),stamp);}finally{await client.query('ALTER TABLE crest_private.audit_events DROP CONSTRAINT synthetic_conversion_refusal');}
 // Children use distinct operations. Only the final parent activity is refused.
 await client.query("ALTER TABLE crest_private.app_sessions ADD CONSTRAINT synthetic_conversion_activity_refusal CHECK(operation_id IS DISTINCT FROM '"+r.operation+"'::uuid) NOT VALID");try{await assert.rejects(convert(f,r),e=>e.code==='23514');assert.deepEqual(await evidence(f),retained);assert.deepEqual(await activity(f),stamp);}finally{await client.query('ALTER TABLE crest_private.app_sessions DROP CONSTRAINT synthetic_conversion_activity_refusal');}
 await web.query('BEGIN');assert.equal((await convert(f,r)).state,'committed');await web.query('ROLLBACK');assert.deepEqual(await evidence(f),retained);assert.deepEqual(await activity(f),stamp);assert.deepEqual(await lookup(f,r.operation),{state:'absent'});
});
test('two devices racing distinct conversion identities produce one complete result and no losing rows',async()=>{
 const f=await state(),second=await session(f),parent=await lead(f),one=request(parent.id),two=request(parent.id),retained=await evidence(f);
 const ids=[(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,(await web2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];await client.query('BEGIN');await client.query('SELECT business_id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[f.business]);const pending=Promise.all([convert(f,one),convert(second,two,web2)]);let blocked=0;
 try{const end=Date.now()+1500;while(Date.now()<end){await client.query('SELECT pg_stat_clear_snapshot()');blocked=(await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[ids])).rows[0].n;if(blocked===2)break;}}finally{await client.query('ROLLBACK');}
 const results=await pending;assert.equal(blocked,2);assert.equal(results.filter(x=>x.state==='committed').length,1);assert.equal(results.filter(x=>x.state==='conflict'&&x.reason==='lead').length,1);assert.deepEqual(await lookup(f,results[0].state==='conflict'?one.operation:two.operation),{state:'absent'});const after=await evidence(f);assert.equal(after['crest.lead_conversions'].length,1);assert.equal(after['crest.customers'].length,1);assert.equal(after['crest_private.operations'].length-retained['crest_private.operations'].length,3);
});
test('two devices racing the original operation return one identical receipt',async()=>{
 const f=await state(),second=await session(f),parent=await lead(f),r=request(parent.id);const results=await Promise.all([convert(f,r),convert(second,r,web2)]);assert.equal(results[0].state,'committed');assert.deepEqual(results[0],results[1]);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.lead_conversions WHERE business_id=$1',[f.business])).rows[0].n,1);
});
test('forced RLS, immutable mapping history and private helpers remain inaccessible to the web role',async()=>{
 const f=await state(),parent=await lead(f),r=request(parent.id);assert.equal((await convert(f,r)).state,'committed');
 for(const table of ['crest.lead_conversions','crest.conversion_links']){assert.equal((await client.query('SELECT relrowsecurity AND relforcerowsecurity AS yes FROM pg_class WHERE oid=$1::regclass',[table])).rows[0].yes,true);for(const sql of [`SELECT * FROM ${table}`,`DELETE FROM ${table}`,`TRUNCATE ${table}`,`UPDATE ${table} SET version=version`])await assert.rejects(web.query(sql),e=>e.code==='42501');for(const sql of [`DELETE FROM ${table}`,`TRUNCATE ${table}`,`UPDATE ${table} SET version=version`]){if(table.endsWith('conversion_links')&&!sql.startsWith('TRUNCATE'))continue;await assert.rejects(client.query(sql),e=>e.code==='55000');}}
 await assert.rejects(web.query('SELECT crest_private.lead_conversion_operation_result($1,$2,$3)',[f.business,f.actor,r.operation]),e=>e.code==='42501');for(const role of ['crest_lead_owner','crest_lead_integrity_owner','crest_customer_owner','crest_vehicle_owner','crest_address_owner'])await assert.rejects(web.query('SET ROLE '+role),e=>e.code==='42501');
});
test('fresh identity and recovery authority protect writes and replay while paused lookup preserves the original receipt',async()=>{
 const f=await state(),parent=await lead(f),r=request(parent.id),first=await convert(f,r);assert.equal(first.state,'committed');const retained=await evidence(f);
 assert.deepEqual(await convert({...f,hash:randomBytes(32)},r),{state:'denied'});await assert.rejects(convert({...f,epoch:randomUUID()},r),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await evidence(f),retained);
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);assert.deepEqual(await lookup(f,r.operation),first);await assert.rejects(convert(f,r),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await evidence(f),retained);
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);assert.deepEqual(await convert(f,r),{state:'denied'});assert.deepEqual(await evidence(f),retained);
});
