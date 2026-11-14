import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { FlattenedEncrypt, flattenedDecrypt } from 'jose';
import { createGoogleCalendarOAuth } from '../../src/operations/google-calendar-oauth.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { recoveryCluster } from '../support/recovery-drill.mjs';

const googleIssuer='https://accounts.google.com';
const googleClient='fictional-calendar.apps.googleusercontent.com';
const callback='https://crest.example.com/api/google-calendar/callback';
const keyId='fictional-calendar-pkce-key';
const key=randomBytes(32);
const mediaType='application/vnd.crest.google-calendar-pkce.v1';
const authIssuer='https://auth.example.com/auth/v1';

async function command(connection, name, args) {
  const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');
  const {rows}=await connection.query('SELECT crest_commands.'+name+'('+placeholders+') AS result',args);
  return rows[0].result;
}

async function attempt(principal,generation='0',client=googleClient,redirect=callback) {
  const id=randomUUID(),state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  const digest=createHash('sha256').update(state).digest();
  const binding=Buffer.from(['crest.google-calendar-pkce.v1',id,principal.business,principal.actor,principal.session,
    principal.epoch,generation,googleIssuer,client,redirect].join('\n'));
  const envelope=await new FlattenedEncrypt(Buffer.from(verifier)).setProtectedHeader({alg:'dir',enc:'A256GCM',kid:keyId,typ:mediaType})
    .setAdditionalAuthenticatedData(binding).encrypt(key);
  return {id,state,digest,verifier,envelope,context:[...principal.auth(),principal.epoch,generation,googleIssuer,client,redirect]};
}

test('a pending Calendar callback releases its encrypted verifier once, only to the initiating authorized owner session', {timeout:120000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox;
  try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const database=await sandbox.database(),admin=await sandbox.connect(database);
    await sandbox.apply(database,await sandbox.prefix(0),true);
    await installProviderSchema(admin,database);
    await sandbox.apply(database,await sandbox.prefix(76));
    await admin.query('BEGIN');
    try{
      for(const proposal of ['outbox','oauth-attempt']) await admin.query(await readFile(
        new URL('../../planning/proposals/google-calendar-'+proposal+'.sql',import.meta.url),'utf8'));
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}

    const web=await sandbox.connect(database);
    await web.query('SET ROLE crest_web');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const fixture=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await fixture(),foreign=await fixture();
    const oauth=await sandbox.connect(database),rival=await sandbox.connect(database);
    await oauth.query('SET ROLE crest_calendar_oauth');
    await rival.query('SET ROLE crest_calendar_oauth');
    const start=(pending,{connection=oauth,context=pending.context,envelope=pending.envelope,digest=pending.digest}={})=>
      command(connection,'begin_google_calendar_oauth_attempt',[...context,pending.id,digest,keyId,envelope]);
    const consume=(pending,{connection=oauth,context=pending.context,digest=pending.digest}={})=>
      command(connection,'consume_google_calendar_oauth_attempt',[...context,pending.id,digest]);
    async function anotherSession(principal,ageSeconds=1){
      const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
      await admin.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",
        [provider,principal.subject]);
      await admin.query(`WITH observed AS MATERIALIZED(SELECT clock_timestamp()-make_interval(secs=>$5) AS stamp)
        INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,
          last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by)
        SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$6,'synthetic',id,id
        FROM crest_private.actors CROSS JOIN observed WHERE id=$2`,[session,principal.actor,provider,hash,ageSeconds,randomBytes(32)]);
      const auth=()=>[hash,session,principal.actor,authIssuer,principal.subject,provider,new Date(Date.now()+60_000),principal.business];
      return {...principal,provider,session,hash,auth};
    }

    const first=await attempt(owner);
    assert.equal(await start(first),null);
    await assert.rejects(start(first,{connection:web}),{code:'42501'});
    await assert.rejects(oauth.query('SELECT * FROM crest_private.google_calendar_oauth_attempts'),{code:'42501'});
    await assert.rejects(oauth.query('SELECT * FROM crest_private.google_calendar_oauth_client'),{code:'42501'});
    await admin.query('INSERT INTO crest_private.google_calendar_oauth_client VALUES(true,$1,$2,$3,$4)',[googleIssuer,googleClient,callback,keyId]);
    const serverOAuth=await createGoogleCalendarOAuth({
      clientId:googleClient,callbackUri:callback,verifierKeyId:keyId,calendarKeyMaterial:randomBytes(32),
      store:{
        async begin(value){
          const context=[...foreign.auth(),value.owner.recoveryEpoch,value.owner.connectionGeneration,
            value.client.issuer,value.client.clientId,value.client.callbackUri];
          return command(oauth,'begin_google_calendar_oauth_attempt',[...context,value.attemptId,value.stateDigest,value.verifierKeyId,value.verifierEnvelope]);
        },
        async consume(value){
          const context=[...foreign.auth(),value.owner.recoveryEpoch,value.owner.connectionGeneration,
            value.client.issuer,value.client.clientId,value.client.callbackUri];
          return command(oauth,'consume_google_calendar_oauth_attempt',[...context,value.attemptId,value.stateDigest]);
        },
      },
    });
    const serverOwner={businessId:foreign.business,actorId:foreign.actor,appSessionId:foreign.session,
      recoveryEpoch:foreign.epoch,connectionGeneration:'0'};
    const signal=new AbortController().signal;
    const authorization=new URL((await serverOAuth.begin(serverOwner,signal)).headers.get('Location'));
    const code='fictional/local-code';
    const callbackRequest=new Request(callback+'?'+new URLSearchParams({state:authorization.searchParams.get('state'),code}));
    const completed=await serverOAuth.callback(callbackRequest,serverOwner,signal);
    assert.equal(completed.state,'exchange_pending');
    const handoff=completed.exchange.takeForOAuthLibrary();
    assert.equal(handoff.code,code);
    assert.equal(createHash('sha256').update(handoff.codeVerifier,'ascii').digest('base64url'),authorization.searchParams.get('code_challenge'));
    assert.deepEqual(await serverOAuth.callback(callbackRequest,serverOwner,signal),{state:'restart'});
    assert.equal(await start(await attempt(owner,'0','other.apps.googleusercontent.com')),null);
    assert.equal(await start(await attempt(owner,'0',googleClient,'https://another.example.com/api/google-calendar/callback')),null);
    assert.equal(await start(first,{digest:Buffer.from(first.state)}),null);
    assert.equal(await start(first,{envelope:{...first.envelope,verifier:first.verifier}}),null);
    assert.equal(await start(first,{envelope:{...first.envelope,aad:'wrong_binding'}}),null);
    const oldSession=await anotherSession(owner,16*60);
    await assert.rejects(start(await attempt(oldSession)),{message:'CREST_MUTATION_AUTHORIZATION_DENIED'});
    const started=await start(first);
    assert.deepEqual(Object.keys(started).sort(),['attemptId','expiresAt']);
    assert.equal(started.attemptId,first.id);
    assert.equal(await start(first),null);
    const pending=(await admin.query('SELECT to_jsonb(a) AS row FROM crest_private.google_calendar_oauth_attempts a WHERE id=$1',[first.id])).rows[0].row;
    const serialized=JSON.stringify(pending);
    assert.equal(serialized.includes(first.state),false);
    assert.equal(serialized.includes(first.verifier),false);
    assert.deepEqual(pending.verifier_envelope,first.envelope);
    assert.equal(Date.parse(pending.expires_at)-Date.parse(pending.created_at),300_000);

    const replacement=await anotherSession(owner);
    const contextFor=(principal,original)=>[...principal.auth(),...original.context.slice(8)];
    assert.equal(await consume(first,{context:contextFor(replacement,first)}),null);
    assert.equal(await consume(first,{context:[...foreign.auth(),foreign.epoch,...first.context.slice(9)]}),null);
    await assert.rejects(consume(first,{context:[...owner.auth().slice(0,7),foreign.business,foreign.epoch,...first.context.slice(9)]}),
      {message:'CREST_MUTATION_AUTHORIZATION_DENIED'});
    assert.equal(await consume(first,{digest:randomBytes(32)}),null);
    const consuming=[consume(first),consume(first,{connection:rival})];
    const replies=await Promise.all(consuming);
    assert.equal(replies.filter(Boolean).length,1);
    const consumed=replies.find(Boolean);
    assert.deepEqual(consumed,{attemptId:first.id,verifierKeyId:keyId,verifierEnvelope:first.envelope});
    const decrypted=await flattenedDecrypt(consumed.verifierEnvelope,key,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
    assert.equal(Buffer.from(decrypted.plaintext).toString(),first.verifier);
    assert.equal(await consume(first),null);
    assert.equal((await admin.query('SELECT verifier_envelope FROM crest_private.google_calendar_oauth_attempts WHERE id=$1',[first.id])).rows[0].verifier_envelope,null);

    const expired=await attempt(owner);
    assert.equal((await start(expired)).attemptId,expired.id);
    await admin.query(`UPDATE crest_private.google_calendar_oauth_attempts
      SET created_at=created_at-interval '6 minutes',expires_at=expires_at-interval '6 minutes' WHERE id=$1`,[expired.id]);
    assert.equal(await consume(expired),null);
    const superseded=await attempt(owner),beforeConnect=await attempt(owner);
    assert.equal((await start(superseded)).attemptId,superseded.id);
    assert.equal((await start(beforeConnect)).attemptId,beforeConnect.id);
    assert.equal(await consume(superseded),null);
    const operations=(await admin.query(`SELECT operation_id FROM crest_private.operations
      WHERE (business_id,actor_id,state)=($1,$2,'committed') ORDER BY created_at,id LIMIT 3`,[owner.business,owner.actor])).rows;
    const destination=randomUUID();
    await admin.query('BEGIN');
    try{
      await admin.query(`INSERT INTO crest.google_calendar_destinations(id,business_id,provider_calendar_id,created_by,operation_id)
       VALUES($1,$2,'fictional-created@group.calendar.google.com',$3,$4)`,[destination,owner.business,owner.actor,operations[0].operation_id]);
      const racing=consume(beforeConnect,{connection:rival});
      await admin.query('COMMIT');
      assert.equal(await racing,null);
    }catch(error){await admin.query('ROLLBACK');throw error;}
    assert.equal(await consume(beforeConnect),null);
    await admin.query('BEGIN');
    try{
      await admin.query('SELECT id FROM crest.google_calendar_destinations WHERE id=$1 FOR UPDATE',[destination]);
      await admin.query(`INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
        client_name,service_label,work_address,created_by,operation_id) VALUES($1,$2,1,$3,'paused',false,false,false,$4,$5)`,
        [owner.business,destination,owner.epoch,owner.actor,operations[1].operation_id]);
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}
    const newGeneration=await attempt(owner,'1');
    assert.equal((await start(newGeneration)).attemptId,newGeneration.id);
    assert.equal(await start(await attempt(owner,'1')),null);
    await admin.query('UPDATE crest_private.google_calendar_oauth_client SET verifier_key_id=$1 WHERE singleton',['replacement-key']);
    assert.equal(await consume(newGeneration),null);
    await admin.query('UPDATE crest_private.google_calendar_oauth_client SET verifier_key_id=$1 WHERE singleton',[keyId]);
    await admin.query('BEGIN');
    try{
      await admin.query('SELECT id FROM crest.google_calendar_destinations WHERE id=$1 FOR UPDATE',[destination]);
      await admin.query(`INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
        client_name,service_label,work_address,created_by,operation_id) VALUES($1,$2,2,$3,'paused',false,false,false,$4,$5)`,
        [owner.business,destination,owner.epoch,owner.actor,operations[2].operation_id]);
      const racing=consume(newGeneration,{connection:rival});
      await admin.query('COMMIT');
      assert.equal(await racing,null);
    }catch(error){await admin.query('ROLLBACK');throw error;}
    await admin.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',
      [owner.business,randomUUID()]);
    await assert.rejects(consume(newGeneration),{message:'RECOVERY_REVIEW_REQUIRED'});
  }finally{
    try{await sandbox?.close();}finally{await cluster.close();}
  }
});
