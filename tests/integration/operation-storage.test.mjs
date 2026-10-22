// Closed-storage invariant tests use disposable admin connections, not a
// production command API or evidence of SDK authentication/replay safety.
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';

let sandbox,client,target,bootstrap,a,b,legacy,legacyRow,history,prior,previous,receipt,completed;
const hash=createHash('sha256').update('synthetic typed payload placeholder').digest('hex');
const result={schemaVersion:1,ids:[]};
const delta={schemaVersion:1,before:null,after:{label:'Synthetic value'}};
async function tenant(){
  const actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic storage owner','https://auth.example.com/auth/v1',$1,$2,$2,'manual') RETURNING id",[randomUUID(),bootstrap])).rows[0].id;
  await client.query('BEGIN');try{
    const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic storage business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
    const epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;
    await client.query('COMMIT');return {actor,business,epoch};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
const claim=(f=a,connection=client,id=randomUUID(),payloadHash=hash,origin='manual',importRow=null)=>connection.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin,import_row_id) VALUES($1,$2,$3,'synthetic.storage',1,$4,$5,$3,$6,$7) RETURNING *",[f.business,id,f.actor,f.epoch,payloadHash,origin,importRow]);
const audit=(op,connection=client,patch={})=>{
  const row={business:op.business_id,operation:op.operation_id,actor:op.actor_id,creator:op.actor_id,entity:randomUUID(),version:'1',delta,origin:op.origin,importRow:op.import_row_id,effective:null,...patch};
  return connection.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin,import_row_id,effective_at) VALUES($1,$2,$3,$4,'synthetic_entities',$5,$6,'create',$7,$8,$9,$10) RETURNING *",[row.business,row.operation,row.actor,row.creator,row.entity,row.version,row.delta,row.origin,row.importRow,row.effective]);
};
const complete=(op,connection=client,value=result,version=1)=>connection.query("UPDATE crest_private.operations SET state='committed',result_schema_version=$3,result=$4 WHERE business_id=$1 AND operation_id=$2 RETURNING *",[op.business_id,op.operation_id,version,value]);
async function transaction(work,connection=client){await connection.query('BEGIN');try{const value=await work();const done=await connection.query('COMMIT');assert.equal(done.command,'COMMIT');return value;}catch(error){await connection.query('ROLLBACK');throw error;}}
async function rejected(work,code){await client.query('SAVEPOINT expected_denial');try{await assert.rejects(work,e=>e.code===code);}finally{await client.query('ROLLBACK TO SAVEPOINT expected_denial');}}
async function committed(f=a,id=randomUUID()){return transaction(async()=>{const op=(await claim(f,client,id)).rows[0],event=(await audit(op)).rows[0];return {op:(await complete(op)).rows[0],event};});}
const count=async(table,id)=>(await client.query(`SELECT count(*)::int AS n FROM crest_private.${table} WHERE operation_id=$1`,[id])).rows[0].n;
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(11));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;a=await tenant();b=await tenant();
  legacy=(await client.query("WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp) INSERT INTO crest_private.app_sessions(actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,created_by,updated_by) SELECT id,$2,$3,current_security_epoch,m.stamp,m.stamp,m.stamp,m.stamp+interval '12 hours',false,id,id FROM crest_private.actors CROSS JOIN moment m WHERE id=$1 RETURNING id",[a.actor,randomUUID(),randomBytes(32)])).rows[0].id;
  legacyRow=(await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[legacy])).rows[0].row;
  history=createHash('sha256').update(JSON.stringify((await client.query('SELECT * FROM crest_private.identity_events ORDER BY id')).rows)).digest('hex');
  previous=await sandbox.apply(target,await sandbox.prefix(12));receipt=await sandbox.apply(target,await sandbox.prefix(13));
  // A CI-only source row demonstrates atomic rollback; no runtime privilege or
  // production domain semantics are inferred from this disposable table.
  await client.query('SET ROLE crest_schema_owner; CREATE TABLE crest.operation_storage_probe(id uuid PRIMARY KEY,operation_id uuid NOT NULL,value text NOT NULL); ALTER TABLE crest.operation_storage_probe ENABLE ROW LEVEL SECURITY; ALTER TABLE crest.operation_storage_probe FORCE ROW LEVEL SECURITY; RESET ROLE');
  completed=await committed();
});
after(async()=>{await sandbox?.close();});

test('schema11/12 upgrades preserve exact CLI prefixes, sessions and identity history',async()=>{
  assert.equal(prior.history.length,11);assert.equal(previous.history.length,12);assert.equal(receipt.history.length,13);
  assert.deepEqual(previous.history.slice(0,11),prior.history);assert.deepEqual(receipt.history.slice(0,12),previous.history);assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(13))).history,receipt.history);
  assert.deepEqual((await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[legacy])).rows[0].row,legacyRow);
  assert.equal(createHash('sha256').update(JSON.stringify((await client.query('SELECT * FROM crest_private.identity_events ORDER BY id')).rows)).digest('hex'),history);
});
test('new relations are forced-RLS, closed to every runtime and owned by the restricted schema owner',async()=>{
  for(const table of ['operations','audit_events']){
    const name=`crest_private.${table}`;
    const row=(await client.query('SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass',[name])).rows[0];assert.deepEqual(row,{relrowsecurity:true,relforcerowsecurity:true,owner:'crest_schema_owner'});
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_policy WHERE polrelid=$1::regclass',[name])).rows[0].n,0);
    for(const role of ['anon','authenticated','service_role','crest_web','crest_worker','crest_recovery','crest_command_owner','crest_session_owner','crest_auth_reader','crest_login_owner']){
      assert.equal((await client.query("SELECT has_any_column_privilege($1,$2,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege($1,$2,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS allowed",[role,name])).rows[0].allowed,false);
    }
  }
  const routines=(await client.query("SELECT proname,prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE pronamespace='crest_private'::regnamespace AND proname=ANY($1)",[['reject_command_history_removal','validate_operation_change','prepare_command_audit','check_operation_completion']])).rows;
  assert.equal(routines.length,4);for(const row of routines){assert.equal(row.prosecdef,false);assert.equal(row.owner,'crest_schema_owner');assert.deepEqual(row.proconfig,['search_path=pg_catalog, pg_temp']);for(const role of ['anon','authenticated','service_role','crest_web','crest_command_owner'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,`crest_private.${row.proname}()`])).rows[0].allowed,false);}
});
test('forged tenant GUCs cannot overcome closed policies even for the forced-RLS table owner',async()=>{
  await client.query('BEGIN');try{await client.query('SET LOCAL ROLE crest_schema_owner');await client.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true)",[a.business,a.actor]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.operations')).rows[0].n,0);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.audit_events')).rows[0].n,0);
    await assert.rejects(claim(),e=>e.code==='42501');
  }finally{await client.query('ROLLBACK');}
});
test('an incomplete claim cannot commit and its source probe rolls back',async()=>{
  const id=randomUUID();await assert.rejects(transaction(async()=>{await claim(a,client,id);await client.query("INSERT INTO crest.operation_storage_probe VALUES($1,$2,'synthetic')",[randomUUID(),id]);}),e=>e.code==='23514'&&e.message==='CREST_OPERATION_COMPLETION_REQUIRED');
  assert.equal(await count('operations',id),0);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.operation_storage_probe WHERE operation_id=$1',[id])).rows[0].n,0);
});
test('a result without audit evidence cannot commit',async()=>{
  const id=randomUUID();await assert.rejects(transaction(async()=>{const op=(await claim(a,client,id)).rows[0];await complete(op);}),e=>e.code==='23514'&&e.message==='CREST_OPERATION_COMPLETION_REQUIRED');assert.equal(await count('operations',id),0);
});
test('audit evidence without a completed result cannot commit',async()=>{
  const id=randomUUID();await assert.rejects(transaction(async()=>{const op=(await claim(a,client,id)).rows[0];await audit(op);}),e=>e.code==='23514');assert.equal(await count('operations',id),0);assert.equal(await count('audit_events',id),0);
});
test('source probe, retained result and audit commit together with stable identifiers',async()=>{
  const id=randomUUID(),entity=randomUUID();const value={schemaVersion:1,ids:[{kind:'synthetic_entities',id:entity,version:'1'}]};
  await transaction(async()=>{const op=(await claim(a,client,id)).rows[0];await client.query("INSERT INTO crest.operation_storage_probe VALUES($1,$2,'synthetic')",[entity,id]);await audit(op,client,{entity});await complete(op,client,value);});
  const op=(await client.query('SELECT * FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[a.business,id])).rows[0];assert.equal(op.state,'committed');assert.deepEqual(op.result,value);assert.equal(await count('audit_events',id),1);assert.equal((await client.query('SELECT id FROM crest.operation_storage_probe WHERE operation_id=$1',[id])).rows[0].id,entity);
});
test('explicit rollback removes claim, result, audit and source so the same UUID can be retried',async()=>{
  const id=randomUUID();await assert.rejects(transaction(async()=>{const op=(await claim(a,client,id)).rows[0];await client.query("INSERT INTO crest.operation_storage_probe VALUES($1,$2,'synthetic')",[randomUUID(),id]);await audit(op);await complete(op);throw new Error('synthetic rollback');}),/synthetic rollback/);
  assert.equal(await count('operations',id),0);assert.equal(await count('audit_events',id),0);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.operation_storage_probe WHERE operation_id=$1',[id])).rows[0].n,0);assert.equal((await committed(a,id)).op.operation_id,id);
});
test('committed operation identity and result cannot be changed or removed',async()=>{
  for(const assignment of ["payload_hash=repeat('b',64)","result='{}'::jsonb",'actor_id=gen_random_uuid()',"state='pending'",'recovery_epoch=gen_random_uuid()','created_at=clock_timestamp()','committed_at=clock_timestamp()'])await assert.rejects(client.query(`UPDATE crest_private.operations SET ${assignment} WHERE id=$1`,[completed.op.id]),e=>e.code==='55000');
  await assert.rejects(client.query('DELETE FROM crest_private.operations WHERE id=$1',[completed.op.id]),e=>e.code==='55000');await assert.rejects(client.query('TRUNCATE crest_private.operations CASCADE'),e=>e.code==='55000');
});
test('audit rows cannot be edited, removed, truncated or added after operation completion',async()=>{
  await assert.rejects(client.query("UPDATE crest_private.audit_events SET reason='rewritten' WHERE id=$1",[completed.event.id]),e=>e.code==='55000');await assert.rejects(client.query('DELETE FROM crest_private.audit_events WHERE id=$1',[completed.event.id]),e=>e.code==='55000');await assert.rejects(client.query('TRUNCATE crest_private.audit_events'),e=>e.code==='55000');await assert.rejects(audit(completed.op),e=>e.code==='55000');
});
test('pending identity cannot be changed while completing a claim',async()=>{
  await transaction(async()=>{const op=(await claim()).rows[0];for(const assignment of ['business_id=gen_random_uuid()','operation_id=gen_random_uuid()',"payload_hash=repeat('b',64)","command_type='other.command'",'schema_version=2','recovery_epoch=gen_random_uuid()',"origin='system'",'import_row_id=gen_random_uuid()'])await rejected(()=>client.query(`UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$2,${assignment} WHERE id=$1`,[op.id,result]),'55000');await audit(op);await complete(op);});
});
test('result snapshots require a matching positive schema and bounded JSON object',async()=>{
  await transaction(async()=>{const op=(await claim()).rows[0];await audit(op);
    for(const [value,version] of [[null,1],[[],1],[{},1],[{schemaVersion:null},1],[{schemaVersion:2},1],[{schemaVersion:1},0],[{schemaVersion:1,value:'x'.repeat(65537)},1]])await rejected(()=>complete(op,client,value,version),'23514');await complete(op);
  });
});
test('audit deltas require versioned before/after objects and never silently truncate',async()=>{
  await transaction(async()=>{const op=(await claim()).rows[0];for(const value of [null,[],{}, {schemaVersion:2,before:null,after:{}},{schemaVersion:1,before:null,after:null},{schemaVersion:1,before:[],after:{}},{...delta,extra:true},{...delta,after:{value:'x'.repeat(262145)}}])await rejected(()=>audit(op,client,{delta:value}),value===null?'23502':'23514');await audit(op);await complete(op);});
});
test('audit links reject other businesses, actors, orphan operations and forged provenance',async()=>{
  await transaction(async()=>{const op=(await claim()).rows[0];for(const patch of [{business:b.business},{actor:b.actor},{operation:randomUUID()}])await rejected(()=>audit(op,client,patch),'23503');
    for(const patch of [{creator:b.actor},{origin:'system'},{importRow:randomUUID()}])await rejected(()=>audit(op,client,patch),'23514');await audit(op);await complete(op);
  });
});
test('operation attribution requires same-business membership and matching creator',async()=>{
  await client.query('BEGIN');try{await rejected(()=>claim({...a,actor:b.actor}),'23503');await rejected(()=>client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,'synthetic.storage',1,$4,$5,$6,'manual')",[a.business,randomUUID(),a.actor,a.epoch,hash,b.actor]),'23514');}finally{await client.query('ROLLBACK');}
});
test('database constructs exact portable hash evidence, UTC instants and decimal-string versions',async()=>{
  const record=await transaction(async()=>{const op=(await claim()).rows[0];await client.query("SET LOCAL TIME ZONE 'Pacific/Honolulu'");const event=(await audit(op,client,{version:'9007199254740993',effective:'2026-01-01T12:34:56.123456Z',delta:{schemaVersion:1,before:null,after:{label:'Synthetic ÃƒÂ© text \\ and "quoted"'}}})).rows[0];await complete(op);return event;});
  assert.equal(record.event_hash,createHash('sha256').update(record.hash_input,'utf8').digest('hex'));assert.deepEqual(JSON.parse(record.hash_input),record.payload);assert.equal(record.payload.entityVersion,'9007199254740993');assert.equal(record.payload.effectiveAt,'2026-01-01T12:34:56.123456Z');assert.match(record.payload.recordedAt,/Z$/);assert.equal(record.payload.hashFormat,'pg17-jsonb-text-utf8-v1');assert.equal(record.payload.businessId,a.business);assert.equal(record.payload.actorId,a.actor);
  const exported=JSON.parse(JSON.stringify({operationId:record.operation_id,hashInput:record.hash_input,eventHash:record.event_hash,payload:record.payload}));assert.equal(createHash('sha256').update(exported.hashInput,'utf8').digest('hex'),exported.eventHash);assert.equal(exported.payload.entityVersion,'9007199254740993');
  await client.query("SET TIME ZONE 'Asia/Tokyo'");try{const reread=(await client.query('SELECT hash_input,event_hash,payload FROM crest_private.audit_events WHERE id=$1',[record.id])).rows[0];assert.equal(reread.hash_input,record.hash_input);assert.equal(reread.event_hash,record.event_hash);assert.deepEqual(reread.payload,record.payload);}finally{await client.query('RESET TIME ZONE');}
});
test('caller-supplied audit payload, principal, hashes and recorded timestamps are replaced by DB evidence',async()=>{
  await transaction(async()=>{const op=(await claim()).rows[0];const event=(await client.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin,payload,hash_input,event_hash,database_principal,created_at,recorded_at) VALUES($1,$2,$3,$3,'synthetic_entities',$4,1,'create',$5,'manual','{}','forged',repeat('a',64),'forged','2000-01-01T00:00:00Z','2000-01-01T00:00:00Z') RETURNING *",[a.business,op.operation_id,a.actor,randomUUID(),delta])).rows[0];assert.notEqual(event.database_principal,'forged');assert.notEqual(event.hash_input,'forged');assert.notEqual(event.event_hash,'a'.repeat(64));assert.equal(event.created_at.getTime(),event.recorded_at.getTime());assert(event.created_at.getTime()>Date.UTC(2026,0,1));const done=(await complete(op)).rows[0];assert(done.committed_at>=done.created_at);assert(event.created_at>=op.created_at);});
});
test('one operation can retain several distinct entity audit events before completion',async()=>{
  const op=await transaction(async()=>{const op=(await claim()).rows[0];for(let index=0;index<3;index++)await audit(op);await complete(op);return op;});assert.equal(await count('audit_events',op.operation_id),3);
});
test('retained operation epochs survive authority rotation without rewriting old evidence',async()=>{
  const before=(await client.query('SELECT to_jsonb(o) AS row FROM crest_private.operations o WHERE id=$1',[completed.op.id])).rows[0].row;
  await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$1,version=version+1 WHERE business_id=$2',[randomUUID(),a.business]);
  assert.deepEqual((await client.query('SELECT to_jsonb(o) AS row FROM crest_private.operations o WHERE id=$1',[completed.op.id])).rows[0].row,before);assert.equal((await client.query('SELECT writes_enabled FROM crest_private.business_recovery_authorities WHERE business_id=$1',[a.business])).rows[0].writes_enabled,false);
});
async function blocked(waiter,holder){const deadline=Date.now()+3000;while(Date.now()<deadline){if((await client.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS value',[waiter,holder])).rows[0].value)return;await delay(10);}assert.fail('required unique-claim lock barrier was not observed');}
const pid=async connection=>(await connection.query('SELECT pg_backend_pid() AS id')).rows[0].id;
test('a concurrent duplicate claim waits for commit and cannot create a second tombstone',async()=>{
  const first=await sandbox.connect(target),second=await sandbox.connect(target),id=randomUUID(),holder=await pid(first),waiter=await pid(second);let pending;await first.query('BEGIN');
  try{const op=(await claim(a,first,id)).rows[0];pending=second.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,'synthetic.storage',1,$4,$5,$3,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id",[a.business,id,a.actor,a.epoch,hash]);void pending.catch(()=>undefined);await blocked(waiter,holder);await audit(op,first);await complete(op,first);await first.query('COMMIT');assert.equal((await pending).rowCount,0);assert.equal(await count('operations',id),1);assert.equal(await count('audit_events',id),1);}
  finally{await first.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('a waiting same-ID claimant proceeds after the first transaction rolls back',async()=>{
  const first=await sandbox.connect(target),second=await sandbox.connect(target),id=randomUUID(),holder=await pid(first),waiter=await pid(second);let pending;await first.query('BEGIN');await second.query('BEGIN');
  try{await claim(a,first,id);pending=claim(a,second,id);void pending.catch(()=>undefined);await blocked(waiter,holder);await first.query('ROLLBACK');const op=(await pending).rows[0];await audit(op,second);await complete(op,second);await second.query('COMMIT');assert.equal(await count('operations',id),1);}
  finally{await first.query('ROLLBACK');await second.query('ROLLBACK');await pending?.catch(()=>undefined);}
});
test('the same operation UUID is independently scoped to two businesses',async()=>{
  const id=randomUUID();const one=await committed(a,id),two=await committed(b,id);assert.notEqual(one.op.id,two.op.id);assert.equal(await count('operations',id),2);assert.equal(await count('audit_events',id),2);
});
test('forcing deferred checks early rejects an unfinished claim but accepts a complete atomic group',async()=>{
  const id=randomUUID();await assert.rejects(transaction(async()=>{await claim(a,client,id);await client.query('SET CONSTRAINTS ALL IMMEDIATE');}),e=>e.code==='23514');assert.equal(await count('operations',id),0);
  await transaction(async()=>{const op=(await claim(a,client,id)).rows[0];await audit(op);await complete(op);await client.query('SET CONSTRAINTS ALL IMMEDIATE');});assert.equal(await count('operations',id),1);
});
test('import provenance is retained as metadata without storing the command request body',async()=>{
  const source=randomUUID();const op=await transaction(async()=>{const op=(await claim(a,client,randomUUID(),hash,'import',source)).rows[0];const event=(await audit(op)).rows[0];assert.equal(event.payload.importRowId,source);assert.equal(event.origin,'import');await complete(op);return op;});assert.equal(op.import_row_id,source);
  const columns=(await client.query("SELECT attname FROM pg_attribute WHERE attrelid='crest_private.operations'::regclass AND attnum>0 AND NOT attisdropped")).rows.map(x=>x.attname);assert(!columns.includes('payload'));assert(!columns.includes('request_body'));
});
test('direct insertion of a completed operation cannot bypass the pending claim transition',async()=>{
  await assert.rejects(client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin,state,result_schema_version,result,committed_at) VALUES($1,$2,$3,'synthetic.storage',1,$4,$5,$3,'manual','committed',1,$6,clock_timestamp())",[a.business,randomUUID(),a.actor,a.epoch,hash,result]),e=>e.code==='23514'&&e.message==='CREST_OPERATION_CLAIM_REQUIRED');
});
test('malformed claim identity, schema, digest and origin are rejected at the database boundary',async()=>{
  await client.query('BEGIN');try{
    for(const [column,value,code] of [['operation_id',null,'23502'],['recovery_epoch',null,'23502'],['command_type','arbitrary','23514'],['schema_version',0,'23514'],['payload_hash','not-a-digest','23514'],['origin','arbitrary','23514']]){
      const columns=['business_id','operation_id','actor_id','command_type','schema_version','recovery_epoch','payload_hash','created_by','origin'];
      const values=[a.business,randomUUID(),a.actor,'synthetic.storage',1,a.epoch,hash,a.actor,'manual'];values[columns.indexOf(column)]=value;
      await rejected(()=>client.query(`INSERT INTO crest_private.operations(${columns.join(',')}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,values),code);
    }
  }finally{await client.query('ROLLBACK');}
});
