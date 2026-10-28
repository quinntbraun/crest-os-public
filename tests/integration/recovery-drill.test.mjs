import {leadAddressColumns,parseLeadAddress} from '../../src/customer/lead-address-contract.ts';
import {leadVehicleColumns,parseLeadVehicle} from '../../src/customer/lead-vehicle-contract.ts';
import {leadEventColumns,parseLeadEvent} from '../../src/customer/lead-state-contract.ts';
import {parseLead,parseLeadSource,leadColumns,leadSourceColumns} from '../../src/customer/lead-contract.ts';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { chmod,copyFile,mkdir,readFile,readdir,stat,unlink,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after,before,test } from 'node:test';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { backupDatabase,connect,hash,inventory,keyPair,privateWorkspace,recoveryCluster,restoreDatabase,roleDefinitions,run,postgresTool,normalizedSchema } from '../support/recovery-drill.mjs';
import {captureObjectArchive,restoreObjectArchive} from '../../src/tooling/object-recovery.ts';
import {objectDirectory,encryptor,decryptor} from '../support/object-recovery-drill.mjs';

let sandbox,source,sourceUrl,sourceWeb,cluster,restored,restoredUrl,point,keys,emergencyKey,directory,backup,owner,original,sourceLogin,restoredLogin,liveSource,sourceLoginOwned=false,restoredLoginOwned=false;
let sourceObjects,vaultObjects,restoredObjects,objectInventory,postSnapshotObject;
let snapshotCustomer,snapshotAddress,snapshotVehicle,snapshotAssociation,nextAssociation,snapshotLeadSource,snapshotLead,sourceReceipt,leadReceipt;
const leadSourceOperation=randomUUID(),leadOperation=randomUUID(),leadStateOperation=randomUUID(),laterLeadStateOperation=randomUUID();
let leadStateReceipt,snapshotLeadEvent;
const leadVehicleOperation=randomUUID(),laterLeadVehicleOperation=randomUUID(),lateLeadVehicleOperation=randomUUID();
let snapshotLeadVehicle,retainedLeadVehicle,leadVehicleReceipt,postSnapshotLeadVehicle;
const reportedDraft=(archived=false)=>({vehicleId:snapshotVehicle,reportedVehicle:{schemaVersion:1,label:'  Synthetic original report é 😀  ',year:-500,make:null,model:null,color:null,vin:' Shared / 001 ',plate:'0001',notes:'Original \\N\n=SUM(A1)'},requestedServices:{schemaVersion:1,text:''},conditionNotes:'Reported only; inspect on site',archived,archiveReason:archived?'Synthetic archived after snapshot':null});
const leadVehicleSave=(operation,id,version,draft)=>sourceWeb.query('SELECT crest_commands.save_lead_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[owner.hash,owner.session,owner.actor,issuer,owner.subject,owner.provider,new Date(Date.now()+120000),owner.business,owner.epoch,operation,snapshotLead,id,version,draft]);
const leadAddressOperation=randomUUID(),laterLeadAddressOperation=randomUUID(),lateLeadAddressOperation=randomUUID();
let snapshotLeadAddress,retainedLeadAddress,leadAddressReceipt,postSnapshotLeadAddress;
const locationDraft=(archived=false)=>({line1:'',line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:'  Synthetic lead location é 😀 \\N\nBehind the barn',instructions:'Original reported access',latitude:'89.999999999999999999999',longitude:'-179.000000000000000000001',geocodeSource:'Owner entered',geocodeAccuracy:null,verifiedAt:'2026-10-25T01:02:03.123456Z',archived,archiveReason:archived?'Synthetic archived after snapshot':null});
const leadAddressSave=(operation,id,version,draft)=>sourceWeb.query('SELECT crest_commands.save_lead_address($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[owner.hash,owner.session,owner.actor,issuer,owner.subject,owner.provider,new Date(Date.now()+120000),owner.business,owner.epoch,operation,snapshotLead,id,version,draft]);
const objectSignal=()=>AbortSignal.timeout(30000);
const objectPorts=destination=>({readVault:vaultObjects.read,unseal:decryptor(emergencyKey),putDestination:destination.put,readDestination:destination.read});
const issuer='https://auth.example.com/auth/v1';
const renameSql='SELECT crest_commands.rename_business($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) AS value';
const args=(f,r)=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,r.operation,r.version,r.name];
const customerSave=(f,id,version,name)=>sourceWeb.query('SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
  [f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,randomUUID(),id,version,{displayName:name,phone:'(317) 555-0100',email:'Synthetic@Example.com',contactPreference:null,outreachOptOut:true,notes:'Synthetic \\N =evidence é 😀',customerSince:null,archived:false,archiveReason:null}]);
const addressSave=(f,id,version,location)=>sourceWeb.query('SELECT crest_commands.save_address($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',
  [f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,randomUUID(),id,snapshotCustomer,version,{line1:'',line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:location,instructions:'Synthetic retained gate',latitude:'89.999999999999999999999',longitude:'-179.000000000000000000001',geocodeSource:'Owner entered',geocodeAccuracy:null,verifiedAt:'2026-10-24T01:02:03.123456Z',archived:false,archiveReason:null}]);
const vehicleSave=(f,id,version,label)=>sourceWeb.query('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
 [f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,randomUUID(),id,version,{label,year:-500,make:null,model:null,color:null,vin:' Raw-vin / é 001 ',plate:'00123',kind:'customer_vehicle',notes:'Synthetic retained vehicle',archived:false,archiveReason:null}]);
const rename=(connection,f,r)=>connection.query(renameSql,args(f,r));
const associationSave=(f,action)=>sourceWeb.query('SELECT crest_commands.change_vehicle_association($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) AS value',
 [f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,randomUUID(),action==='open'?'0':'1',{action,associationId:snapshotAssociation,customerId:snapshotCustomer,vehicleId:snapshotVehicle,effectiveAt:action==='open'?'2026-10-01T00:00:00.000000Z':'2026-10-25T00:00:00.000001Z',relationship:action==='open'?'owner':'keeper',isBilling:true,evidence:'Synthetic retained association \u00e9 \u{1f600}',reason:action==='open'?null:'Synthetic transfer after snapshot',nextAssociationId:action==='open'?null:nextAssociation}]);
const leadSourceSave=(f,id,version,label,active=true)=>sourceWeb.query('SELECT crest_commands.save_lead_source($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
 [f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,version==='0'?leadSourceOperation:randomUUID(),id,version,{label,kind:'Owner-recorded synthetic source',active,referralCustomerId:snapshotCustomer}]);
const leadSave=(f,id,version,label,estimatedCents)=>sourceWeb.query('SELECT crest_commands.save_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
 [f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,version==='0'?leadOperation:randomUUID(),id,version,{label,customerId:snapshotCustomer,sourceId:snapshotLeadSource,referralText:'Synthetic retained referral',phone:'(317) 001-0001',email:'Original@Example.com',requestedScope:'Interior and exterior',availability:null,estimatedCents,followUpAt:'2026-11-01T01:02:03.123456Z',notes:'Synthetic retained lead \\N =evidence é 😀'}]);
const changeLeadState=(f,operation,version,fromState,toState,reason)=>sourceWeb.query('SELECT crest_commands.change_lead_state($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,operation,snapshotLead,version,{fromState,toState,reason}]);
const request=(version='2',name='Synthetic restored review')=>({operation:randomUUID(),version,name});
const closed=work=>assert.rejects(work,/SYNTHETIC_RECOVERY_RESTORE_FAILED/);

async function session(client,f){
  const value={...f,session:randomUUID(),provider:randomUUID(),hash:randomBytes(32)};
  try{
  await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[value.provider,value.subject]);
  // Sample the database clock exactly once: authenticated_at must be <=created_at.
  await client.query("WITH observed AS MATERIALIZED (SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,observed.stamp,observed.stamp,observed.stamp,observed.stamp+interval '1 hour',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[value.session,value.actor,value.provider,value.hash,randomBytes(32)]);
  return value;
  }catch{throw new Error('SYNTHETIC_RECOVERY_SESSION_SEED_FAILED');}
}
async function web(url,admin){
  const login=`recovery_web_${randomBytes(8).toString('hex')}`,password=randomBytes(32).toString('hex');
  await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  await admin.query(`GRANT crest_web TO ${login}`);const u=new URL(url);u.username=login;u.password=password;
  const connection=await connect(u.toString());await connection.query('SET ROLE crest_web');return {connection,login};
}
async function emptyRestore(){const url=await cluster.database();return {url,client:await connect(url)};}
async function alteredPoint(name,change){
  const path=join(directory,name);await mkdir(path,{mode:0o700});
  for(const file of ['database.age','manifest.age','receipt.json'])await copyFile(join(point,file),join(path,file));
  await change(path);return path;
}
before(async()=>{
  directory=await privateWorkspace();const kit=join(directory,'emergency-kit');point=join(directory,'point');await mkdir(kit,{mode:0o700});await mkdir(point,{mode:0o700});
  keys=await keyPair(kit);emergencyKey=join(kit,'independent-key.txt');await copyFile(keys.path,emergencyKey);await chmod(emergencyKey,0o600);
  sandbox=await migrationSandbox();sourceUrl=await sandbox.database();source=await sandbox.connect(sourceUrl);
  await sandbox.apply(sourceUrl,await sandbox.prefix(0),true);await installProviderSchema(source,sourceUrl);await sandbox.apply(sourceUrl);
  const bootstrap=(await source.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id,subject=randomUUID();
  const actor=(await source.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic recovery owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
  await source.query('BEGIN');
  const business=(await source.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic before backup','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
  await source.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  const epoch=(await source.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await source.query('COMMIT');
  await source.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,'synthetic-recovery@example.com','authenticated','authenticated')",[subject]);owner=await session(source,{actor,subject,business,epoch});
  // An otherwise unknown schema/table and a sequence ensure a selective export
  // cannot masquerade as a database backup. This fixture is never a migration.
  await source.query("CREATE SCHEMA recovery_fixture; CREATE SEQUENCE recovery_fixture.counter START 9007199254740993; CREATE TABLE recovery_fixture.evidence(id bigint PRIMARY KEY DEFAULT nextval('recovery_fixture.counter'),exact_time timestamptz NOT NULL,original bytea NOT NULL,label text NOT NULL CHECK(length(label)>0)); INSERT INTO recovery_fixture.evidence(exact_time,original,label) VALUES('2026-10-24T01:02:03.123456Z',decode('000102ff00','hex'),'Unicode é 😀 \\N =formula');");
  sourceObjects=await objectDirectory(join(directory,'source-objects'));vaultObjects=await objectDirectory(join(directory,'vault-objects'));restoredObjects=await objectDirectory(join(directory,'restored-objects'));
  // The real domain tables do not exist yet. Keep an explicitly drill-only
  // inventory schema, captured with the actual exported database snapshot.
  await source.query('CREATE TABLE recovery_fixture.objects(key text PRIMARY KEY, "byteSize" integer NOT NULL,sha256 text NOT NULL,retention text NOT NULL,state text NOT NULL)');
  for(const [i,retention] of ['original','derivative','quarantine'].entries()){
    const key=retention==='quarantine'?`staging/${business}/${randomUUID()}/${randomUUID()}`:`${i===0?'originals':'previews'}/${business}/${randomUUID()}`,bytes=Buffer.from(`Synthetic retained ${retention} é 😀`);
    await sourceObjects.put(key,bytes,objectSignal());await source.query('INSERT INTO recovery_fixture.objects VALUES($1,$2,$3,$4,$5)',[key,bytes.length,hash(bytes),retention,i===0?'Archived':i===1?'Available':'Quarantined']);
  }
  const w=await web(sourceUrl,sandbox.admin);sourceWeb=w.connection;sourceLogin=w.login;sourceLoginOwned=true;
  original=request('1','Synthetic committed before snapshot');assert.equal((await rename(sourceWeb,owner,original)).rows[0].value.state,'committed');
  snapshotCustomer=randomUUID();assert.equal((await customerSave(owner,snapshotCustomer,'0','Synthetic customer before snapshot')).rows[0].value.state,'committed');
  snapshotAddress=randomUUID();assert.equal((await addressSave(owner,snapshotAddress,'0','Synthetic address before snapshot')).rows[0].value.state,'committed');
  snapshotVehicle=randomUUID();assert.equal((await vehicleSave(owner,snapshotVehicle,'0','Synthetic vehicle before snapshot')).rows[0].value.state,'committed');
  snapshotAssociation=randomUUID();nextAssociation=randomUUID();assert.equal((await associationSave(owner,'open')).rows[0].value.state,'committed');
  snapshotLeadSource=randomUUID();sourceReceipt=(await leadSourceSave(owner,snapshotLeadSource,'0','Synthetic source before snapshot')).rows[0].value;assert.equal(sourceReceipt.state,'committed');
  snapshotLead=randomUUID();leadReceipt=(await leadSave(owner,snapshotLead,'0','Synthetic lead before snapshot','9007199254740993')).rows[0].value;assert.equal(leadReceipt.state,'committed');
  leadStateReceipt=(await changeLeadState(owner,leadStateOperation,'1','new','lost','Synthetic retained Lost reason é 😀')).rows[0].value;assert.equal(leadStateReceipt.state,'committed');
  snapshotLeadEvent=(await source.query('SELECT crest_private.lead_event_projection(e) AS value FROM crest.lead_events e WHERE id=$1',[leadStateReceipt.receipt.leadEventId])).rows[0].value;
  snapshotLeadVehicle=randomUUID();leadVehicleReceipt=(await leadVehicleSave(leadVehicleOperation,snapshotLeadVehicle,'0',reportedDraft())).rows[0].value;assert.equal(leadVehicleReceipt.state,'committed');
  retainedLeadVehicle=(await source.query('SELECT crest_private.lead_vehicle_projection(v) AS value FROM crest.lead_vehicles v WHERE id=$1',[snapshotLeadVehicle])).rows[0].value;
  snapshotLeadAddress=randomUUID();leadAddressReceipt=(await leadAddressSave(leadAddressOperation,snapshotLeadAddress,'0',locationDraft())).rows[0].value;assert.equal(leadAddressReceipt.state,'committed');
  retainedLeadAddress=(await source.query('SELECT crest_private.lead_address_projection(a) AS value FROM crest.lead_addresses a WHERE id=$1',[snapshotLeadAddress])).rows[0].value;
  backup=await backupDatabase(source,sourceUrl,point,keys.recipient,async()=>{
    assert.equal((await rename(sourceWeb,owner,request('2','Synthetic committed after snapshot'))).rows[0].value.state,'committed');
    assert.equal((await customerSave(owner,snapshotCustomer,'1','Synthetic customer after snapshot')).rows[0].value.state,'committed');
    assert.equal((await addressSave(owner,snapshotAddress,'1','Synthetic address after snapshot')).rows[0].value.state,'committed');
    assert.equal((await vehicleSave(owner,snapshotVehicle,'1','Synthetic vehicle after snapshot')).rows[0].value.state,'committed');
    assert.equal((await associationSave(owner,'transfer')).rows[0].value.state,'committed');
    assert.equal((await leadSourceSave(owner,snapshotLeadSource,'1','Synthetic source after snapshot',false)).rows[0].value.state,'committed');
    assert.equal((await leadSave(owner,snapshotLead,'2','Synthetic lead after snapshot','9223372036854775807')).rows[0].value.state,'committed');
    assert.equal((await changeLeadState(owner,laterLeadStateOperation,'3','lost','follow_up','Synthetic reopen after snapshot')).rows[0].value.state,'committed');
    assert.equal((await leadVehicleSave(laterLeadVehicleOperation,snapshotLeadVehicle,'1',{...reportedDraft(true),conditionNotes:'Synthetic report after snapshot'})).rows[0].value.state,'committed');
    postSnapshotLeadVehicle=randomUUID();assert.equal((await leadVehicleSave(lateLeadVehicleOperation,postSnapshotLeadVehicle,'0',{...reportedDraft(),vehicleId:null})).rows[0].value.state,'committed');
    assert.equal((await leadAddressSave(laterLeadAddressOperation,snapshotLeadAddress,'1',{...locationDraft(true),instructions:'Synthetic location after snapshot'})).rows[0].value.state,'committed');
    postSnapshotLeadAddress=randomUUID();assert.equal((await leadAddressSave(lateLeadAddressOperation,postSnapshotLeadAddress,'0',locationDraft())).rows[0].value.state,'committed');
    const key=`originals/${business}/${randomUUID()}`,bytes=Buffer.from('Committed after snapshot');postSnapshotObject=key;
    await sourceObjects.put(key,bytes,objectSignal());
    const later=await connect(sourceUrl);try{await later.query('INSERT INTO recovery_fixture.objects VALUES($1,$2,$3,$4,$5)',[key,bytes.length,hash(bytes),'original','Available']);}finally{await later.end();}
    const independent=await connect(sourceUrl);try{liveSource=await inventory(independent);}finally{await independent.end();}
  },{async inventory(client){objectInventory=(await client.query('SELECT key,"byteSize",sha256,retention FROM recovery_fixture.objects ORDER BY key COLLATE "C"')).rows;return objectInventory;},
    capture:objects=>captureObjectArchive(randomUUID(),objects,{readSource:sourceObjects.read,seal:encryptor(keys.recipient),putVault:vaultObjects.put,readVault:vaultObjects.read})});
  cluster=await recoveryCluster();restoredUrl=await cluster.database();
  // The fresh process receives no source URL/credential and has only the copy
  // of the emergency key after the original is removed.
  await unlink(keys.path);
  let output;
  try{output=await run(process.execPath,['tests/support/restore-recovery-drill.mjs',point,emergencyKey],{env:{...process.env,CREST_TEST_DATABASE_URL:'',CREST_RECOVERY_DRILL_TARGET:restoredUrl,CREST_RECOVERY_DRILL_VAULT:join(directory,'vault-objects'),CREST_RECOVERY_DRILL_OBJECTS:join(directory,'restored-objects')}});}
  catch(error){
    if(error.message!=='SYNTHETIC_RECOVERY_TOOL_FAILED:schema')throw error;
    const expected=normalizedSchema(await postgresTool('pg_dump',sourceUrl,['--schema-only'])),actual=normalizedSchema(await postgresTool('pg_dump',restoredUrl,['--schema-only']));
    assert.equal(hash(expected),backup.manifest.schemaSha256,'source schema changed after capture');
    const left=expected.split('\n'),right=actual.split('\n'),at=left.findIndex((line,i)=>line!==right[i]);
    // Only fixed public Crest DDL headers/grants and exact lines already in the
    // published customer migration may cross diagnostics. No source data, SQL
    // comments/bodies from arbitrary objects or connection details are emitted.
    const publicLines=new Set((await readFile(new URL('../../supabase/migrations/20261025020000_customer_directory.sql',import.meta.url),'utf8')).split('\n').map(s=>s.trim()));
    const safe=line=>line===''?'[blank]':publicLines.has(line?.trim())&&line?.trim()?line:
      /^(?:GRANT|REVOKE|ALTER DEFAULT PRIVILEGES|CREATE FUNCTION|ALTER FUNCTION|CREATE TABLE|ALTER TABLE|CREATE TYPE|ALTER TYPE) [A-Za-z0-9_ .(),;"]+$/.test(line??'')&&/\bcrest(?:_|\.)[a-z_]+\b/.test(line)?line:'[schema statement withheld]';
    const object=lines=>{for(let i=at;i>=0;i--)if(/^(?:CREATE FUNCTION|CREATE TABLE|CREATE TYPE) crest(?:_|\.)/.test(lines[i]))return safe(lines[i]);return '[object withheld]';};
    // This fixture creates customers solely from the registered migrations and
    // makes no later customer DDL changes. Its table definition has no secrets
    // or source records; preserve literal control characters for exact diagnosis.
    const table=lines=>object(lines)==='CREATE TABLE crest.customers ('?lines.slice(Math.max(0,at-1),at+8):[];
    throw new Error('SYNTHETIC_SCHEMA_REVIEW_REQUIRED:'+JSON.stringify({line:at+1,expectedObject:object(left),actualObject:object(right),expected:left.slice(Math.max(0,at-1),at+8).map(safe),actual:right.slice(Math.max(0,at-1),at+8).map(safe),expectedCustomerDdl:table(left),actualCustomerDdl:table(right)}),{cause:error});
  }
  assert.match(output.toString(),/^Synthetic isolated database restore and verification completed\s*$/);
  restored=await connect(restoredUrl);
},{timeout:240000});
after(async()=>{
  await sourceWeb?.end();
  if(sourceLoginOwned)await sandbox.admin.query(`DROP ROLE ${sourceLogin}`);
  if(restoredLoginOwned)await restored.query(`DROP ROLE ${restoredLogin}`);
  await restored?.end();await cluster?.close();await sandbox?.close();
});

test('actual encrypted database recovery works in a fresh process and separate cluster',async()=>{
  assert.notEqual(new URL(sourceUrl).port,new URL(restoredUrl).port);
  assert.deepEqual(await inventory(restored),backup.manifest.rows);
  assert.deepEqual(await roleDefinitions(restored),backup.manifest.roles);
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,backup.manifest.schemaVersion);
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM auth.schema_migrations')).rows[0].n,(await source.query('SELECT count(*)::int AS n FROM auth.schema_migrations')).rows[0].n);
  assert.equal(backup.manifest.completeBackup,false); // vault/files/config/full release remain unfinished
});
test('one exported snapshot preserves prior operations and excludes concurrent committed changes',async()=>{
  assert.equal((await restored.query('SELECT legal_name FROM crest.businesses WHERE id=$1',[owner.business])).rows[0].legal_name,original.name);
  assert.equal((await source.query('SELECT legal_name FROM crest.businesses WHERE id=$1',[owner.business])).rows[0].legal_name,'Synthetic committed after snapshot');
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest_private.operations')).rows[0].n,10);
  assert.equal((await source.query('SELECT count(*)::int AS n FROM crest_private.operations')).rows[0].n,22);
});
test('actual customer contacts, raw notes and source audit recover at the exact snapshot version',async()=>{
  const customer=(await restored.query('SELECT crest_private.customer_projection(c) AS value FROM crest.customers c WHERE id=$1',[snapshotCustomer])).rows[0].value;
  assert.equal(customer.display_name,'Synthetic customer before snapshot');assert.equal(customer.version,'1');assert.equal(customer.phone_raw,'(317) 555-0100');assert.equal(customer.phone_normalized,'3175550100');assert.equal(customer.email_raw,'Synthetic@Example.com');assert.equal(customer.outreach_opt_out,true);assert.equal(customer.notes,'Synthetic \\N =evidence é 😀');
  assert.equal((await source.query('SELECT display_name FROM crest.customers WHERE id=$1',[snapshotCustomer])).rows[0].display_name,'Synthetic customer after snapshot');
  const audit=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='customers' AND entity_id=$2",[owner.business,snapshotCustomer])).rows;assert.equal(audit.length,1);assert.deepEqual(audit[0].delta.after,customer);
});

test('actual address parent, exact decimals, verification and source audit restore at the same database snapshot',async()=>{
  const address=(await restored.query('SELECT crest_private.address_projection(a) AS value FROM crest.addresses a WHERE id=$1',[snapshotAddress])).rows[0].value;
  assert.equal(address.customer_id,snapshotCustomer);assert.equal(address.version,'1');assert.equal(address.line1,'');assert.equal(address.city,null);assert.equal(address.exact_location_text,'Synthetic address before snapshot');assert.equal(address.latitude,'89.999999999999999999999');assert.equal(address.longitude,'-179.000000000000000000001');assert.equal(address.verified_at,'2026-10-24T01:02:03.123456Z');
  assert.equal((await source.query('SELECT exact_location_text FROM crest.addresses WHERE id=$1',[snapshotAddress])).rows[0].exact_location_text,'Synthetic address after snapshot');const events=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='addresses' AND entity_id=$2",[owner.business,snapshotAddress])).rows;assert.equal(events.length,1);assert.deepEqual(events[0].delta.after,address);
});

test('vehicle source, raw VIN/generated hint and audit restore at the same encrypted snapshot',async()=>{
 const v=(await restored.query('SELECT crest_private.vehicle_projection(v) AS value FROM crest.vehicles v WHERE id=$1',[snapshotVehicle])).rows[0].value;assert.equal(v.label,'Synthetic vehicle before snapshot');assert.equal(v.version,'1');assert.equal(v.year,-500);assert.equal(v.vin_raw,' Raw-vin / é 001 ');assert.equal(v.vin_normalized,'RAWVIN001');assert.equal(v.plate,'00123');
 assert.equal((await source.query('SELECT label FROM crest.vehicles WHERE id=$1',[snapshotVehicle])).rows[0].label,'Synthetic vehicle after snapshot');const events=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='vehicles' AND entity_id=$2",[owner.business,snapshotVehicle])).rows;assert.equal(events.length,1);assert.deepEqual(events[0].delta.after,v);
});

test('dated association and UUID GiST exclusions recover at the earlier snapshot before the later atomic transfer',async()=>{
 const a=(await restored.query('SELECT crest_private.association_projection(a) AS value FROM crest.customer_vehicles a WHERE id=$1',[snapshotAssociation])).rows[0].value;
 assert.equal(a.customer_id,snapshotCustomer);assert.equal(a.vehicle_id,snapshotVehicle);assert.equal(a.version,'1');assert.equal(a.valid_to,null);assert.equal(a.relationship,'owner');assert.equal(a.is_billing,true);assert.equal(a.evidence,'Synthetic retained association é 😀');
 assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest.customer_vehicles WHERE business_id=$1',[owner.business])).rows[0].n,1);assert.equal((await source.query('SELECT count(*)::int AS n FROM crest.customer_vehicles WHERE business_id=$1',[owner.business])).rows[0].n,2);
 const events=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='customer_vehicles' AND entity_id=$2",[owner.business,snapshotAssociation])).rows;assert.equal(events.length,1);assert.deepEqual(events[0].delta.after,a);
 const constraints=(await restored.query("SELECT conname FROM pg_constraint WHERE conrelid='crest.customer_vehicles'::regclass AND contype='x' ORDER BY conname")).rows;assert.deepEqual(constraints.map(r=>r.conname),['association_billing_period','association_owner_period']);
});

test('lead source/referral, original label and immutable source audit restore before the later deactivation',async()=>{
 const row=(await restored.query('SELECT crest_private.lead_source_projection(c) AS value FROM crest.lead_sources c WHERE id=$1',[snapshotLeadSource])).rows[0].value;
 parseLeadSource(row,owner.business);assert.equal(row.version,'1');assert.equal(row.label,'Synthetic source before snapshot');assert.equal(row.active,true);assert.equal(row.referral_customer_id,snapshotCustomer);
 const live=(await source.query('SELECT crest_private.lead_source_projection(c) AS value FROM crest.lead_sources c WHERE id=$1',[snapshotLeadSource])).rows[0].value;assert.equal(live.version,'2');assert.equal(live.label,'Synthetic source after snapshot');assert.equal(live.active,false);
 const events=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='lead_sources' AND entity_id=$2",[owner.business,snapshotLeadSource])).rows;assert.equal(events.length,1);assert.deepEqual(events[0].delta.after,row);
});
test('lead source snapshot, exact cents/microseconds, genuine customer and original receipts restore together',async()=>{
 const row=(await restored.query('SELECT crest_private.lead_projection(c) AS value FROM crest.leads c WHERE id=$1',[snapshotLead])).rows[0].value;
 parseLead(row,owner.business);assert.equal(row.version,'2');assert.equal(row.label,'Synthetic lead before snapshot');assert.equal(row.customer_id,snapshotCustomer);assert.equal(row.source_id,snapshotLeadSource);assert.equal(row.source_snapshot.version,'1');assert.equal(row.source_snapshot.label,'Synthetic source before snapshot');assert.equal(row.estimated_cents,'9007199254740993');assert.equal(row.follow_up_at,'2026-11-01T01:02:03.123456Z');assert.equal(row.phone_normalized,'3170010001');assert.equal(row.availability,null);assert.equal(row.state,'lost');assert.equal(row.lost_reason,'Synthetic retained Lost reason é 😀');assert.equal(row.notes,'Synthetic retained lead \\N =evidence é 😀');
 const live=(await source.query('SELECT crest_private.lead_projection(c) AS value FROM crest.leads c WHERE id=$1',[snapshotLead])).rows[0].value;assert.equal(live.version,'4');assert.equal(live.state,'follow_up');assert.equal(live.estimated_cents,'9223372036854775807');assert.equal(live.source_snapshot.version,'1');
 const events=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='leads' AND entity_id=$2 ORDER BY entity_version",[owner.business,snapshotLead])).rows;assert.equal(events.length,2);assert.equal(events[0].delta.after.version,'1');assert.deepEqual(events[1].delta.after,row);
 const w=await web(restoredUrl,restored);try{
  for(const [command,operation,expected]of [['lead',leadOperation,leadReceipt],['lead_source',leadSourceOperation,sourceReceipt]]){
   const result=(await w.connection.query('SELECT crest_commands.lookup_'+command+'_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[owner.hash,owner.session,owner.actor,issuer,owner.subject,owner.provider,new Date(Date.now()+120000),owner.business,operation])).rows[0].value;assert.deepEqual(result,expected);
  }
  for(const role of ['crest_lead_owner','crest_lead_integrity_owner','crest_lead_source_owner','crest_lead_source_integrity_owner'])await assert.rejects(w.connection.query('SET ROLE '+role),e=>e.code==='42501');
  for(const table of ['leads','lead_sources'])await assert.rejects(w.connection.query('SELECT * FROM crest.'+table),e=>e.code==='42501');
 }finally{await w.connection.end();await restored.query('DROP ROLE '+w.login);}
 assert.equal((await restored.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private') AND c.relkind='r'")).rows[0].n,41);
 const journalTables=['export_job_attempts','export_job_completions','export_job_snapshots','export_jobs','export_part_intents','export_part_verifications'];
 assert.deepEqual((await restored.query("SELECT c.relname AS name,c.relrowsecurity AND c.relforcerowsecurity AND c.relowner='crest_schema_owner'::regrole AS closed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crest_private' AND c.relkind='r' AND c.relname=ANY($1::text[]) ORDER BY c.relname",[journalTables])).rows,journalTables.map(name=>({name,closed:true})));
});

test('registered coverage accounts for every actual source column and rejects omissions on the restored schema',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8'));assert.equal(manifest.migrationCount,45);assert.deepEqual(manifest.tables.find(t=>t.table==='crest.lead_vehicles').required,[...leadVehicleColumns]);
 assert.deepEqual(manifest.tables.find(t=>t.table==='crest.lead_addresses').required,[...leadAddressColumns]);
 assert.deepEqual(manifest.tables.find(t=>t.table==='crest.lead_events').required,[...leadEventColumns]);
 assert.deepEqual(manifest.tables.find(t=>t.table==='crest.lead_sources').required,[...leadSourceColumns]);assert.deepEqual(manifest.tables.find(t=>t.table==='crest.leads').required,[...leadColumns]);
 const columns=(await restored.query(`SELECT n.nspname||'.'||c.relname AS "table",a.attname AS "column" FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN ('crest','crest_private') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2`)).rows;
 assert.deepEqual(verifyExportCoverage(manifest,columns,45),{assurance:'schema_inventory_only',tables:44,requiredColumns:693,excludedColumns:10,partialEvidenceTables:9,completePortableExport:false,completeBackup:false});
 const missing=structuredClone(manifest);missing.tables.find(t=>t.table==='crest.leads').required.pop();assert.throws(()=>verifyExportCoverage(missing,columns,45),/EXPORT_COVERAGE_REVIEW_REQUIRED/);
});

test('immutable18-column Lost event restores exactly before the later reopen',async()=>{
 const rows=(await restored.query('SELECT crest_private.lead_event_projection(e) AS value FROM crest.lead_events e WHERE lead_id=$1 ORDER BY lead_version',[snapshotLead])).rows.map(x=>x.value);
 assert.deepEqual(rows,[snapshotLeadEvent]);parseLeadEvent(rows[0],owner.business);assert.equal(Object.keys(rows[0]).length,18);assert.equal(rows[0].reason,'Synthetic retained Lost reason é 😀');assert.equal(rows[0].lead_version,'2');
 const live=(await source.query('SELECT crest_private.lead_event_projection(e) AS value FROM crest.lead_events e WHERE lead_id=$1 ORDER BY lead_version',[snapshotLead])).rows.map(x=>x.value);assert.equal(live.length,2);assert.equal(live[1].to_state,'follow_up');assert.equal(live[1].lead_version,'4');
 const eventAudit=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE entity_kind='lead_events' AND entity_id=$1",[snapshotLeadEvent.id])).rows;assert.equal(eventAudit.length,1);assert.deepEqual(eventAudit[0].delta.after,snapshotLeadEvent);
});
test('original state receipt and paired audits recover while the later reopen operation stays absent',async()=>{
 const w=await web(restoredUrl,restored);try{
  for(const [operation,expected] of [[leadStateOperation,leadStateReceipt],[laterLeadStateOperation,{state:'absent'}]]){
   const result=(await w.connection.query('SELECT crest_commands.lookup_lead_state_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[owner.hash,owner.session,owner.actor,issuer,owner.subject,owner.provider,new Date(Date.now()+120000),owner.business,operation])).rows[0].value;assert.deepEqual(result,expected);
  }
  await assert.rejects(w.connection.query('SELECT * FROM crest.lead_events'),e=>e.code==='42501');
 }finally{await w.connection.end();await restored.query('DROP ROLE '+w.login);}
 assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest_private.audit_events WHERE operation_id=$1',[leadStateOperation])).rows[0].n,2);
});
test('restored event retention, forced RLS and state-event requirement still reject direct rewrites',async()=>{
 assert.equal((await restored.query("SELECT relrowsecurity AND relforcerowsecurity AS yes FROM pg_class WHERE oid='crest.lead_events'::regclass")).rows[0].yes,true);
 for(const sql of ["UPDATE crest.lead_events SET reason='forged'","DELETE FROM crest.lead_events","TRUNCATE crest.lead_events"])await assert.rejects(restored.query(sql),e=>e.code==='55000');
 await assert.rejects(restored.query("UPDATE crest.leads SET state='contacted',lost_reason=NULL,version=version+1 WHERE id=$1",[snapshotLead]),/IMMUTABLE_LEAD_STATE_EVENT_REQUIRED/);
});

test('all17 lead vehicle source fields restore at the same exported snapshot with genuine original parents and source audit',async()=>{
 const row=(await restored.query('SELECT crest_private.lead_vehicle_projection(v) AS value FROM crest.lead_vehicles v WHERE id=$1',[snapshotLeadVehicle])).rows[0].value;
 assert.deepEqual(parseLeadVehicle(row,owner.business,snapshotLead),retainedLeadVehicle);assert.equal(Object.keys(row).length,17);assert.equal(row.vehicle_id,snapshotVehicle);assert.equal(row.version,'1');assert.equal(row.archived_at,null);assert.equal(row.requested_services.text,'');
 const live=(await source.query('SELECT crest_private.lead_vehicle_projection(v) AS value FROM crest.lead_vehicles v WHERE id=$1',[snapshotLeadVehicle])).rows[0].value;assert.equal(live.version,'2');assert.equal(live.condition_notes,'Synthetic report after snapshot');assert.notEqual(live.archived_at,null);
 const audits=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE entity_kind='lead_vehicles' AND entity_id=$1",[snapshotLeadVehicle])).rows;assert.equal(audits.length,1);assert.equal(audits[0].delta.before,null);assert.deepEqual(audits[0].delta.after,row);
 assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest.lead_vehicles WHERE id=$1',[postSnapshotLeadVehicle])).rows[0].n,0);
});
test('original lead vehicle receipt and later absent operations remain independently resolvable after encrypted restore',async()=>{
 const w=await web(restoredUrl,restored);try{
  for(const [operation,expected] of [[leadVehicleOperation,leadVehicleReceipt],[laterLeadVehicleOperation,{state:'absent'}],[lateLeadVehicleOperation,{state:'absent'}]]){
   const value=(await w.connection.query('SELECT crest_commands.lookup_lead_vehicle_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[owner.hash,owner.session,owner.actor,issuer,owner.subject,owner.provider,new Date(Date.now()+120000),owner.business,operation])).rows[0].value;assert.deepEqual(value,expected);
  }
  await assert.rejects(w.connection.query('SELECT * FROM crest.lead_vehicles'),e=>e.code==='42501');await assert.rejects(w.connection.query('SELECT crest_commands.lead_vehicle_snapshot_context($1)',[owner.business]),e=>e.code==='42501');
 }finally{await w.connection.end();await restored.query('DROP ROLE '+w.login);}
});
test('restored lead vehicle retention, immutable provenance and complete deferred audits still reject direct rewrites',async()=>{
 assert.equal((await restored.query("SELECT relrowsecurity AND relforcerowsecurity AS yes FROM pg_class WHERE oid='crest.lead_vehicles'::regclass")).rows[0].yes,true);
 await assert.rejects(restored.query('DELETE FROM crest.lead_vehicles'),e=>e.code==='55000');
 await assert.rejects(restored.query('TRUNCATE crest.lead_vehicles'),e=>e.code==='0A000');
 await assert.rejects(restored.query('TRUNCATE crest.lead_vehicles,crest.conversion_links'),e=>e.code==='55000');
 await assert.rejects(restored.query('UPDATE crest.lead_vehicles SET id=$1,version=version+1 WHERE id=$2',[randomUUID(),snapshotLeadVehicle]),e=>e.code==='55000');
 await assert.rejects(restored.query("UPDATE crest.lead_vehicles SET condition_notes='forged',version=version+1 WHERE id=$1",[snapshotLeadVehicle]),e=>e.code==='23514');assert.deepEqual((await restored.query('SELECT crest_private.lead_vehicle_projection(v) AS value FROM crest.lead_vehicles v WHERE id=$1',[snapshotLeadVehicle])).rows[0].value,retainedLeadVehicle);
});
test('restored private directory and complete history expose original reported intake without directory-description overwrite',async()=>{
 const w=await web(restoredUrl,restored);try{
  const args=[owner.hash,owner.session,owner.actor,issuer,owner.subject,owner.provider,new Date(Date.now()+120000),owner.business];
  const page=(await w.connection.query('SELECT crest_commands.read_lead_vehicles($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,true,10) AS value',[...args,snapshotLead])).rows[0].value;assert.deepEqual(page.leadVehicles,[retainedLeadVehicle]);assert.equal(page.leadVersion,'2');assert.equal(page.hasMore,false);
  const history=(await w.connection.query('SELECT crest_commands.read_lead_vehicle_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,5) AS value',[...args,snapshotLead,snapshotLeadVehicle])).rows[0].value;assert.equal(history.history.length,1);assert.deepEqual(history.history[0].after,retainedLeadVehicle);assert.equal(history.history[0].before,null);
 }finally{await w.connection.end();await restored.query('DROP ROLE '+w.login);}
});

test('all26 lead-owned location fields restore with exact coordinates, original lead and source audit',async()=>{
 const row=(await restored.query('SELECT crest_private.lead_address_projection(a) AS value FROM crest.lead_addresses a WHERE id=$1',[snapshotLeadAddress])).rows[0].value;
 assert.deepEqual(parseLeadAddress(row,owner.business,snapshotLead),retainedLeadAddress);assert.equal(Object.keys(row).length,26);assert.equal(row.version,'1');assert.equal(row.archived_at,null);assert.equal(row.line1,'');assert.equal(row.city,null);assert.equal(row.exact_location_text,locationDraft().exactLocationText);assert.equal(row.latitude,locationDraft().latitude);assert.equal(row.longitude,locationDraft().longitude);assert.equal(row.verified_at,locationDraft().verifiedAt);
 const live=(await source.query('SELECT crest_private.lead_address_projection(a) AS value FROM crest.lead_addresses a WHERE id=$1',[snapshotLeadAddress])).rows[0].value;assert.equal(live.version,'2');assert.equal(live.instructions,'Synthetic location after snapshot');assert.notEqual(live.archived_at,null);
 const audits=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE entity_kind='lead_addresses' AND entity_id=$1",[snapshotLeadAddress])).rows;assert.equal(audits.length,1);assert.equal(audits[0].delta.before,null);assert.deepEqual(audits[0].delta.after,row);
 assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest.lead_addresses WHERE id=$1',[postSnapshotLeadAddress])).rows[0].n,0);
});
test('original lead address receipt resolves after encrypted restore while later edits and new sources stay absent',async()=>{
 const w=await web(restoredUrl,restored);try{
  for(const [operation,expected] of [[leadAddressOperation,leadAddressReceipt],[laterLeadAddressOperation,{state:'absent'}],[lateLeadAddressOperation,{state:'absent'}]]){
   const value=(await w.connection.query('SELECT crest_commands.lookup_lead_address_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[owner.hash,owner.session,owner.actor,issuer,owner.subject,owner.provider,new Date(Date.now()+120000),owner.business,operation])).rows[0].value;assert.deepEqual(value,expected);
  }
  await assert.rejects(w.connection.query('SELECT * FROM crest.lead_addresses'),e=>e.code==='42501');await assert.rejects(w.connection.query('SELECT crest_commands.lead_address_snapshot_context($1)',[owner.business]),e=>e.code==='42501');
 }finally{await w.connection.end();await restored.query('DROP ROLE '+w.login);}
});
test('restored lead address RLS, retention, immutable parent and complete deferred audit still enforce integrity',async()=>{
 assert.equal((await restored.query("SELECT relrowsecurity AND relforcerowsecurity AS yes FROM pg_class WHERE oid='crest.lead_addresses'::regclass")).rows[0].yes,true);
 await assert.rejects(restored.query('DELETE FROM crest.lead_addresses'),e=>e.code==='55000');
 await assert.rejects(restored.query('TRUNCATE crest.lead_addresses'),e=>e.code==='0A000');
 await assert.rejects(restored.query('TRUNCATE crest.lead_addresses,crest.conversion_links'),e=>e.code==='55000');
 await assert.rejects(restored.query('UPDATE crest.lead_addresses SET id=$1,version=version+1 WHERE id=$2',[randomUUID(),snapshotLeadAddress]),e=>e.code==='55000');
 await assert.rejects(restored.query("UPDATE crest.lead_addresses SET instructions='forged',version=version+1 WHERE id=$1",[snapshotLeadAddress]),e=>e.code==='23514');assert.deepEqual((await restored.query('SELECT crest_private.lead_address_projection(a) AS value FROM crest.lead_addresses a WHERE id=$1',[snapshotLeadAddress])).rows[0].value,retainedLeadAddress);
});
test('restored private lead address pages and history retain original locations without overwriting customer addresses',async()=>{
 const w=await web(restoredUrl,restored);try{
  const args=[owner.hash,owner.session,owner.actor,issuer,owner.subject,owner.provider,new Date(Date.now()+120000),owner.business];
  const page=(await w.connection.query('SELECT crest_commands.read_lead_addresses($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,true,10) AS value',[...args,snapshotLead])).rows[0].value;assert.deepEqual(page.leadAddresses,[retainedLeadAddress]);assert.equal(page.leadVersion,'2');assert.equal(page.hasMore,false);
  const history=(await w.connection.query('SELECT crest_commands.read_lead_address_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,5) AS value',[...args,snapshotLead,snapshotLeadAddress])).rows[0].value;assert.equal(history.history.length,1);assert.deepEqual(history.history[0].after,retainedLeadAddress);assert.equal(history.history[0].before,null);
 }finally{await w.connection.end();await restored.query('DROP ROLE '+w.login);}
 assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest.addresses WHERE business_id=$1',[owner.business])).rows[0].n,1);
});

test('same-snapshot retained files restore with Archived and quarantined evidence, excluding later commits',async()=>{
  assert.deepEqual((await restored.query('SELECT key,"byteSize",sha256,retention FROM recovery_fixture.objects ORDER BY key COLLATE "C"')).rows,objectInventory);
  assert.equal(objectInventory.length,3);assert.equal((await source.query('SELECT count(*)::int AS n FROM recovery_fixture.objects')).rows[0].n,4);
  for(const object of objectInventory){const b=await restoredObjects.read(object.key,object.byteSize,objectSignal());assert.equal(hash(b),object.sha256);assert.deepEqual(b,await sourceObjects.read(object.key,object.byteSize,objectSignal()));}
  await assert.rejects(readFile(restoredObjects.path(postSnapshotObject)),e=>e.code==='ENOENT');assert(!backup.manifest.excluded.includes('external_objects'));
});

test('missing referenced original blocks database restoration before SQL without touching the source',async()=>{
  const entry=objectInventory.find(o=>o.retention==='original'),index=objectInventory.indexOf(entry),key=`recovery/${backup.manifest.objectArchive.receipt.pointId}/objects/${index}.age`,path=vaultObjects.path(key),saved=await readFile(path);
  const f=await emptyRestore(),destination=await objectDirectory(join(directory,'missing-object-destination'));
  try{await unlink(path);await closed(restoreDatabase(point,emergencyKey,f.url,a=>restoreObjectArchive(a.receipt,a.inventory,objectPorts(destination))));assert.deepEqual(await inventory(f.client),[]);assert.deepEqual(await readdir(join(directory,'missing-object-destination')),[]);}
  finally{await writeFile(path,saved,{flag:'wx',mode:0o600});await f.client.end();}
});

test('object archive requires an explicit restore transport and cannot silently restore DB alone',async()=>{
  const f=await emptyRestore();try{await closed(restoreDatabase(point,emergencyKey,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('unknown-schema rows retain exact bigint, microseconds, binary bytes and sequence state',async()=>{
  assert.deepEqual((await restored.query("SELECT id::text,to_char(exact_time AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS stamp,encode(original,'hex') AS original,label FROM recovery_fixture.evidence")).rows,(await source.query("SELECT id::text,to_char(exact_time AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS stamp,encode(original,'hex') AS original,label FROM recovery_fixture.evidence")).rows);
  assert.equal((await restored.query("SELECT nextval('recovery_fixture.counter')::text AS value")).rows[0].value,'9007199254740994');
});
test('private recovery point contains ciphertext and a non-secret receipt, without the original key',async()=>{
  assert.deepEqual((await readdir(point)).sort(),['database.age','manifest.age','receipt.json']);
  for(const file of ['database.age','manifest.age']){const bytes=await readFile(join(point,file));assert.match(bytes.subarray(0,32).toString(),/^age-encryption.org\/v1/);assert.equal((await stat(join(point,file))).mode&0o077,0);}
  await assert.rejects(readFile(keys.path),e=>e.code==='ENOENT');assert.equal((await stat(emergencyKey)).mode&0o077,0);
});
test('wrong emergency key fails before creating schema or business rows',async()=>{
  const other=await keyPair(directory),f=await emptyRestore();try{await closed(restoreDatabase(point,other.path,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('missing ciphertext never becomes a successful recovery',async()=>{
  const altered=await alteredPoint('missing',async p=>unlink(join(p,'database.age'))),f=await emptyRestore();try{await closed(restoreDatabase(altered,emergencyKey,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('truncated ciphertext fails the exact receipt check before SQL',async()=>{
  const altered=await alteredPoint('truncated',async p=>{const path=join(p,'database.age');const bytes=await readFile(path);await writeFile(path,bytes.subarray(0,bytes.length-1));}),f=await emptyRestore();try{await closed(restoreDatabase(altered,emergencyKey,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('ciphertext tampering still fails authenticated decryption with a recomputed public checksum',async()=>{
  const altered=await alteredPoint('tampered',async p=>{const path=join(p,'database.age'),bytes=await readFile(path);bytes[bytes.length-20]^=1;await writeFile(path,bytes);const r=JSON.parse(await readFile(join(p,'receipt.json'),'utf8'));r.dump.sha256=hash(bytes);await writeFile(join(p,'receipt.json'),JSON.stringify(r));}),f=await emptyRestore();try{await closed(restoreDatabase(altered,emergencyKey,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('a populated destination is rejected without overwriting its evidence',async()=>{
  const f=await emptyRestore();try{await f.client.query('CREATE TABLE public.retained(id integer PRIMARY KEY); INSERT INTO public.retained VALUES(7)');await closed(restoreDatabase(point,emergencyKey,f.url));assert.deepEqual((await f.client.query('SELECT * FROM public.retained')).rows,[{id:7}]);}finally{await f.client.end();}
});
test('an existing function without tables also prevents restore',async()=>{
  const f=await emptyRestore();try{await f.client.query('CREATE FUNCTION public.retained() RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$');await closed(restoreDatabase(point,emergencyKey,f.url));assert.equal((await f.client.query('SELECT public.retained() AS value')).rows[0].value,7);}finally{await f.client.end();}
});
test('restored grants/RLS block raw writes and privileged role assumption',async()=>{
  const w=await web(restoredUrl,restored);restoredLogin=w.login;restoredLoginOwned=true;
  try{for(const role of ['crest_schema_owner','crest_session_owner','crest_command_owner'])await assert.rejects(w.connection.query(`SET ROLE ${role}`),e=>e.code==='42501');await assert.rejects(w.connection.query('SELECT token_hash FROM crest_private.app_sessions'),e=>e.code==='42501');await assert.rejects(w.connection.query("UPDATE crest.businesses SET legal_name='forged'"),e=>e.code==='42501');
    const tables=(await restored.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private') AND relkind='r'")).rows;assert(tables.length>=22);assert(tables.every(t=>t.relrowsecurity&&t.relforcerowsecurity));
  }finally{await w.connection.end();}
});
test('restored FK/check/append-only guards still enforce source integrity',async()=>{
  await assert.rejects(restored.query("UPDATE crest.businesses SET timezone='',version=version+1 WHERE id=$1",[owner.business]),e=>e.code==='23514');
  await assert.rejects(restored.query('DELETE FROM crest.memberships WHERE actor_id=$1',[owner.actor]),e=>['23503','55000'].includes(e.code));
  await assert.rejects(restored.query("UPDATE crest_private.audit_events SET action='forged'"),e=>e.code==='55000');
});
test('one-microsecond authentication drift is rejected; the corrected seed shares one exact timestamp',async()=>{
  await restored.query('BEGIN');try{
    await assert.rejects(restored.query("INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT gen_random_uuid(),actor_id,$2,$3,issued_security_epoch,created_at,created_at+interval '1 microsecond',created_at,created_at+interval '1 hour',false,provider_token_ciphertext,key_id,created_by,updated_by FROM crest_private.app_sessions WHERE id=$1",[owner.session,randomUUID(),randomBytes(32)]),e=>e.code==='23514'&&e.constraint==='app_sessions_check2');
  }finally{await restored.query('ROLLBACK');}
  await restored.query('BEGIN');try{
    const fresh=await session(restored,owner);
    assert.equal((await restored.query("SELECT created_at=authenticated_at AND created_at=last_active_at AND expires_at=created_at+interval '1 hour' AS exact FROM crest_private.app_sessions WHERE id=$1",[fresh.session])).rows[0].exact,true);
  }finally{await restored.query('ROLLBACK');}
});
test('incident fixture pauses authority, revokes sessions and records a new epoch independently',async()=>{
  const incident=randomUUID(),epoch=randomUUID(),file=join(directory,'independent-incident.json');
  // This is a drill-only administrative fixture, not an exposed recovery command.
  // The original source remains running separately; production old-writer fencing
  // and owner incident authorization are explicit unfinished activation gates.
  await writeFile(file,JSON.stringify({incident,businessId:owner.business,priorEpoch:owner.epoch,epoch,writesEnabled:false}),{flag:'wx',mode:0o600});
  await restored.query('BEGIN');try{
    await restored.query('SELECT id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[owner.business]);
    await restored.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,active_epoch=$1,incident_id=$2,version=version+1 WHERE business_id=$3',[epoch,incident,owner.business]);
    await restored.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE revoked_at IS NULL');
    await restored.query('UPDATE crest_private.actors SET current_security_epoch=gen_random_uuid(),version=version+1 WHERE kind=\'owner\'');
    await restored.query('DELETE FROM auth.sessions');await restored.query('COMMIT');
  }catch(error){await restored.query('ROLLBACK');throw error;}
  const authority=(await restored.query('SELECT active_epoch,writes_enabled,incident_id FROM crest_private.business_recovery_authorities WHERE business_id=$1',[owner.business])).rows[0];
  assert.deepEqual(authority,{active_epoch:epoch,writes_enabled:false,incident_id:incident});assert.equal(JSON.parse(await readFile(file,'utf8')).epoch,epoch);
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE revoked_at IS NULL OR provider_token_ciphertext IS NOT NULL OR key_id IS NOT NULL')).rows[0].n,0);
});
test('old restored credentials are denied; fresh credentials cannot bypass paused writes or replay old epochs',async()=>{
  const u=new URL(restoredUrl); // fresh login is separate from backup role definitions
  const w=await web(u.toString(),restored);
  try{
    assert.deepEqual((await rename(w.connection,owner,original)).rows[0].value,{state:'denied'});
    const current=await session(restored,owner),epoch=(await restored.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[owner.business])).rows[0].active_epoch;
    for(const command of [original,request()])await assert.rejects(rename(w.connection,current,command),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
    await assert.rejects(rename(w.connection,{...current,epoch},request()),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
    await restored.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[owner.business]);
    for(const command of [original,request()])await assert.rejects(rename(w.connection,current,command),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
    const result=(await rename(w.connection,{...current,epoch},request())).rows[0].value;assert.equal(result.state,'committed');assert.equal(result.recoveryEpoch,epoch);
    const retained=(await restored.query('SELECT recovery_epoch,result FROM crest_private.operations WHERE operation_id=$1',[original.operation])).rows[0];assert.equal(retained.recovery_epoch,owner.epoch);assert.equal(retained.result.businessVersion,'2');
    assert.equal((await source.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[owner.business])).rows[0].active_epoch,owner.epoch);
  }finally{await w.connection.end();await restored.query(`DROP ROLE ${w.login}`);}
});
test('backup, isolated restore and incident fixtures never alter the original source',async()=>{
  assert.deepEqual(await inventory(source),liveSource);
});
