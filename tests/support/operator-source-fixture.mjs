// Disposable source-projection fixtures. These are not Google consent or login
// workflow acceptance, and they never run against a non-test database.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {captureOperatorSources138,formatOperatorSourceExport} from '../../src/tooling/operator-source-export.ts';
import {operatorSourceInventory138} from '../../src/tooling/operator-source-inventory138.ts';
import {readCurrentBusinessCsv} from '../../src/security/current-business-source-csv.ts';
export async function exerciseOperatorSources({admin,owner,other,migrations,createReader,createForbiddenReader}){
 assert.equal(process.env.CREST_ENV,'test');const stamp='2026-01-02T03:04:05.123456Z',secret='OPERATOR_EXCLUDED_SENTINEL',special=" =SUM(1,2)\r\nUnicode 🚙, quote \" and \\N'; SELECT 1; --",loginContext=randomUUID();
 await admin.query('INSERT INTO crest_private.login_attempts(id,identifier_hash,ip_hash,admitted_at) VALUES($1,$2,$3,$4::timestamptz)',[randomUUID(),randomBytes(32),randomBytes(32),stamp]);
 await admin.query("INSERT INTO crest_private.login_contexts(id,credential_hash,ip_hash,csrf_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5::timestamptz,$5::timestamptz+interval '10 minutes')",[loginContext,randomBytes(32),randomBytes(32),randomBytes(32),stamp]);
 for(const principal of[owner,other]){
  await admin.query('INSERT INTO crest_private.google_calendar_worker_principals VALUES($1,$2) ON CONFLICT(business_id) DO NOTHING',[principal.business,'operator_fixture_'+randomUUID().replaceAll('-','')]);
  await admin.query('INSERT INTO crest_private.session_csrf_tokens(session_id,token_hash,created_at) VALUES($1,$2,$3::timestamptz)',[principal.session,randomBytes(32),stamp]);
  await admin.query("INSERT INTO crest_private.session_request_admissions(session_id,bucket,admitted_at) VALUES($1,'ordinary',$2::timestamptz)",[principal.session,stamp]);
  await admin.query(`INSERT INTO crest_private.google_calendar_oauth_attempts(id,business_id,actor_id,session_id,recovery_epoch,destination_id,connection_generation,issuer,client_id,callback_uri,state_digest,verifier_key_id,verifier_envelope,created_at,expires_at)
   VALUES($1,$2,$3,$4,$5,NULL,0,'https://accounts.google.com',$6,'https://example.test/api/google-calendar/callback',$7,$8,$9::jsonb,$10::timestamptz,$10::timestamptz+interval '5 minutes')`,[randomUUID(),principal.business,principal.actor,principal.session,principal.epoch,special,randomBytes(32),secret,JSON.stringify({ciphertext:secret}),stamp]);
 }
 await admin.query("INSERT INTO crest_private.google_calendar_oauth_client VALUES(true,'https://accounts.google.com','operator-fixture.apps.googleusercontent.com','https://example.test/api/google-calendar/callback',$1) ON CONFLICT DO NOTHING",[secret]);
 await admin.query('INSERT INTO crest_private.google_calendar_credential_key VALUES(true,$1) ON CONFLICT DO NOTHING',[secret]);
 await admin.query("SET timezone='UTC'");await admin.query("SET datestyle='ISO, YMD'");
 const capture=await captureOperatorSources138({client:await createReader(),leaseBusinessId:owner.business,migrations},new AbortController().signal),value=capture.forRecoveryTools();assert.throws(()=>JSON.stringify(capture));assert.equal(value.scope,'instance_operator');assert.equal(value.sourceSchemaVersion,138);assert.equal(value.completePortableExport,false);assert.equal(value.completeBackup,false);assert.equal(value.sources.length,10);
 const files=formatOperatorSourceExport(capture),escapes=JSON.parse(Buffer.from(files['operator_escape_map.json']).toString()),manifest=JSON.parse(Buffer.from(files['operator_manifest.json']).toString());
 assert.equal(manifest.profile,'crest.private-operator-csv.v2');assert.equal(manifest.scope,'instance_operator');assert.equal(manifest.referenceClosureVerified,false);assert.equal(manifest.completePortableExport,false);assert.equal(manifest.completeBackup,false);assert.equal(Object.keys(files).length,14);assert.throws(()=>formatOperatorSourceExport(structuredClone(value)),{message:'OPERATOR_SOURCE_EXPORT_REVIEW_REQUIRED'});
 for(const source of value.sources){
  const expected=operatorSourceInventory138.find(item=>item.source===source.source);assert.deepEqual(source.columns,expected.columns);assert(source.rows.length>0,source.source+' must have positive source rows');
  const sql='SELECT '+source.columns.map(column=>'"'+column+'"::text AS "'+column+'"').join(',')+' FROM ONLY '+source.source+' ORDER BY '+source.primaryKey.map(column=>'"'+column+'"').join(',');
  assert.deepEqual(source.rows,(await admin.query(sql)).rows);const name=source.source.replace('.','_')+'.csv';assert.deepEqual(readCurrentBusinessCsv(Buffer.from(files[name]).toString(),source.columns,escapes[name]),source.rows);
 }
 const attempts=value.sources.find(source=>source.source==='crest_private.google_calendar_oauth_attempts');assert(attempts.rows.some(row=>row.business_id===owner.business&&row.client_id===special));assert(attempts.rows.some(row=>row.business_id===other.business&&row.client_id===special));
 const context=value.sources.find(source=>source.source==='crest_private.login_contexts').rows.find(row=>row.id===loginContext);assert.equal(context.created_at,'2026-01-02 03:04:05.123456+00');assert.equal(context.consumed_at,null);
 for(const bytes of Object.values(files))assert(!Buffer.from(bytes).toString().includes(secret));
 await assert.rejects(captureOperatorSources138({client:await createForbiddenReader(),leaseBusinessId:owner.business,migrations},new AbortController().signal),{message:'OPERATOR_SOURCE_EXPORT_REVIEW_REQUIRED'});
 await admin.query('ALTER TABLE crest_private.login_contexts ADD COLUMN operator_unreviewed_fixture text');
 try{await assert.rejects(captureOperatorSources138({client:await createReader(),leaseBusinessId:owner.business,migrations},new AbortController().signal),{message:'OPERATOR_SOURCE_EXPORT_REVIEW_REQUIRED'});}finally{await admin.query('ALTER TABLE crest_private.login_contexts DROP COLUMN operator_unreviewed_fixture');}
 const repaired=await captureOperatorSources138({client:await createReader(),leaseBusinessId:owner.business,migrations},new AbortController().signal);assert.deepEqual(repaired.forRecoveryTools().sources,value.sources);return{sourceCount:10,allPositive:true,exactPostgresCells:true,excludedCredentialsAbsent:true,unknownColumnRefused:true,expectedFiles:files,recordCount:value.recordCount,completePortableExport:false,completeBackup:false};
}
