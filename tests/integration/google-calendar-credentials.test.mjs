import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createGoogleCalendarOAuth, googleCalendarOAuthIssuer, googleCalendarOAuthScope } from '../../src/operations/google-calendar-oauth.ts';
import { createGoogleCalendarCredentialStore } from '../../src/operations/google-calendar-credential-store.ts';
import { createGoogleCalendarConnection } from '../../src/operations/google-calendar-connection.ts';
import { createGoogleCalendarOAuthTransport } from '../../src/operations/google-calendar-oauth-transport.ts';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { recoveryCluster } from '../support/recovery-drill.mjs';

async function call(connection, command, args) {
  const placeholders=args.map((_,index)=>'$'+(index+1)).join(',');
  return (await connection.query('SELECT crest_commands.'+command+'('+placeholders+') AS result',args)).rows[0].result;
}

const issuer=googleCalendarOAuthIssuer, scope=googleCalendarOAuthScope;
const client='fictional-crest.apps.googleusercontent.com';
const callback='https://crest.example.com/api/google-calendar/callback';
const verifierKey='fictional-pkce-key', credentialKey='fictional-credential-key';
const secret=randomBytes(32), signal=new AbortController().signal;
const binding=(owner,destination,generation,id,version)=>({businessId:owner.business,destinationId:destination,
  connectionGeneration:generation,recoveryEpoch:owner.epoch,clientId:client,credentialId:id,version});

test('Calendar credentials are sealed and refresh admits one worker per active credential version', {timeout:120000}, async()=>{
  const credentialStore=await createGoogleCalendarCredentialStore({activeKeyId:credentialKey,calendarKeyMaterial:secret});
  const transport=createGoogleCalendarOAuthTransport({clientId:client,callbackUri:callback,clientSecret:'fixture-secret',
    admit:async()=>false,request:async()=>{throw Error('Native credential test has no provider transport');}});
  async function sealed(owner,destination,generation,id,version,key=credentialKey){
    const store=key===credentialKey?credentialStore:await createGoogleCalendarCredentialStore({activeKeyId:key,calendarKeyMaterial:secret});
    const grant=transport.openRetained({clientId:client,scope,accessToken:'fictional-access-'+version,refreshToken:'fictional-refresh-'+version,
      expiresAt:Date.now()+3600_000,refreshExpiresAt:null});
    return (await store.seal(binding(owner,destination,generation,id,version),grant)).envelope;
  }
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
      for(const proposal of ['outbox','dispatch','oauth-attempt','disconnect','credentials']) await admin.query(await readFile(
        new URL('../../planning/proposals/google-calendar-'+proposal+'.sql',import.meta.url),'utf8'));
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}
    const web=await sandbox.connect(database);
    await web.query('SET ROLE crest_web');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const fixture=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await fixture(),foreign=await fixture();
    const oauth=await sandbox.connect(database),rivalOAuth=await sandbox.connect(database);
    await oauth.query('SET ROLE crest_calendar_oauth');
    await rivalOAuth.query('SET ROLE crest_calendar_oauth');
    await admin.query('INSERT INTO crest_private.google_calendar_oauth_client VALUES(true,$1,$2,$3,$4)',[issuer,client,callback,verifierKey]);
    await admin.query('INSERT INTO crest_private.google_calendar_credential_key VALUES(true,$1)',[credentialKey]);
    const auth=principal=>[...principal.auth(),principal.epoch];
    const context=(principal,generation)=>[...auth(principal),generation,issuer,client,callback];
    const operations=principal=>admin.query(`SELECT operation_id FROM crest_private.operations WHERE (business_id,actor_id,state)=($1,$2,'committed')
      ORDER BY created_at,id LIMIT 2`,[principal.business,principal.actor]).then(result=>result.rows);
    const ops=await operations(owner);
    const destination=randomUUID(),id=randomUUID(),providerId='fixture-only@group.calendar.google.com',reviewedOwner='reviewed-owner@example.com';
    await admin.query(`INSERT INTO crest.google_calendar_destinations(id,business_id,provider_calendar_id,created_by,operation_id)
      VALUES($1,$2,$3,$4,$5)`,[destination,owner.business,providerId,owner.actor,ops[0].operation_id]);
    const protocol=await createGoogleCalendarOAuth({
      clientId:client,callbackUri:callback,verifierKeyId:verifierKey,calendarKeyMaterial:randomBytes(32),
      store:{
        begin: (v)=>call(oauth,'begin_google_calendar_oauth_attempt',[
          ...context(owner,v.owner.connectionGeneration),v.attemptId,v.stateDigest,v.verifierKeyId,v.verifierEnvelope]),
        consume: (v)=>call(oauth,'consume_google_calendar_oauth_attempt',[
          ...context(owner,v.owner.connectionGeneration),v.attemptId,v.stateDigest]),
      },
    });
    const browserOwner={businessId:owner.business,actorId:owner.actor,appSessionId:owner.session,recoveryEpoch:owner.epoch,connectionGeneration:'0'};
    async function start(input=browserOwner){
      const redirect=new URL((await protocol.begin(input,signal)).headers.get('Location'));
      const state=redirect.searchParams.get('state');
      return {id:state.split('.')[0],request:new Request(callback+'?'+new URLSearchParams({state,code:'fictional/code'}))};
    }
    const superseded=await start(),pending=await start();
    const admit=(attempt,connection=oauth,principal=owner,generation='0')=>
      call(connection,'admit_google_calendar_code_exchange',[...context(principal,generation),attempt]);
    assert.equal(await admit(superseded.id),null);
    assert.equal(await admit(pending.id),null);
    const accepted=await protocol.callback(pending.request,browserOwner,signal);
    assert.equal(accepted.state,'exchange_pending');
    assert.equal(await admit(pending.id,rivalOAuth,foreign),null);
    await assert.rejects(admit(pending.id,web),{code:'42501'});
    assert.equal(await admit(pending.id),null);
    const confirm=(target=destination,remote=providerId,approved=true,principal=owner)=>
      call(oauth,'confirm_google_calendar_setup_destination',[...context(principal,'0'),target,remote,reviewedOwner,approved]);
    assert.equal(await confirm(destination,providerId,false),false);
    assert.equal(await confirm(randomUUID()),false);
    assert.equal(await confirm(destination,'wrong@group.calendar.google.com'),false);
    assert.equal(await confirm(destination,providerId,true,foreign),false);
    assert.equal(await confirm(),true);
    const admissions=await Promise.all([admit(accepted.exchange.attemptId),admit(accepted.exchange.attemptId,rivalOAuth)]);
    assert.equal(admissions.filter(Boolean).length,1);
    assert.equal(admissions.find(Boolean).attemptId,pending.id);
    const later=await start();
    assert.equal((await protocol.callback(later.request,browserOwner,signal)).state,'exchange_pending');
    assert.equal(await admit(later.id),null);

    const stage=(envelope,key=credentialKey,attempt=pending.id)=>
      call(oauth,'stage_google_calendar_credential',[...auth(owner),destination,attempt,id,key,envelope]);
    const first=await sealed(owner,destination,'1',id,'1');
    const destinationAdmission=(connection=oauth,principal=owner)=>call(connection,'admit_google_calendar_setup_destination',
      [...context(principal,'0'),pending.id]);
    const finishDestination=(target=destination)=>call(oauth,'finish_google_calendar_setup_destination',[...context(owner,'0'),pending.id,target]);
    assert.equal(await stage(first),null);
    assert.equal(await finishDestination(),false);
    assert.equal(await destinationAdmission(rivalOAuth,foreign),null);
    assert.equal(await confirm(),false);
    const verifiedTargets=await Promise.all([destinationAdmission(),destinationAdmission(rivalOAuth)]);
    assert.equal(verifiedTargets.filter(Boolean).length,1);
    assert.deepEqual(verifiedTargets.find(Boolean),{destinationId:destination,providerCalendarId:providerId,reviewedCalendarOwner:reviewedOwner});
    assert.equal(await stage(first),null);
    assert.equal(await finishDestination(randomUUID()),false);
    assert.equal(await finishDestination(),true);
    assert.equal(await finishDestination(),false);
    assert.equal(await stage({...first,refreshToken:'raw-token'}),null);
    assert.equal(await stage(await sealed(owner,destination,'2',id,'1')),null);
    assert.equal(await stage(await sealed(owner,destination,'1',id,'1',verifierKey),verifierKey),null);
    assert.equal(await stage(first,credentialKey,superseded.id),null);
    assert.deepEqual(await stage(first),{credentialId:id,generation:'1',version:'1'});
    assert.equal(await stage(first),null);

    async function worker(name,principal=null){
      if(principal){
        await admin.query('CREATE ROLE '+name+' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
        await admin.query('GRANT crest_calendar_dispatch TO '+name);
        await admin.query('INSERT INTO crest_private.google_calendar_worker_principals(business_id,principal) VALUES($1,$2)',[principal.business,name]);
      }
      const connection=await sandbox.connect(database);
      await connection.query('SET SESSION AUTHORIZATION '+name);
      await connection.query('SET ROLE crest_calendar_dispatch');
      return connection;
    }
    const agent=await worker('synthetic_credential_worker',owner);
    const rival=await worker('synthetic_credential_worker');
    const other=await worker('synthetic_foreign_worker',foreign);
    const boundary=[owner.business,destination,owner.epoch,'1'];
    const claim=(connection=agent)=>call(connection,'claim_google_calendar_refresh',boundary);
    const finish=(claimId,outcome,key=null,envelope=null)=>call(agent,'finish_google_calendar_refresh',[...boundary,claimId,outcome,key,envelope]);
    assert.equal(await claim(),null);
    await assert.rejects(claim(other),{message:'GOOGLE_CALENDAR_WORKER_DENIED'});
    await assert.rejects(claim(web),{code:'42501'});
    await assert.rejects(agent.query('SELECT envelope FROM crest_private.google_calendar_credentials'),{code:'42501'});
    await assert.rejects(oauth.query('SELECT envelope FROM crest_private.google_calendar_credentials'),{code:'42501'});
    await admin.query(`INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
      client_name,service_label,work_address,created_by,operation_id) VALUES($1,$2,1,$3,'active',false,false,false,$4,$5)`,
      [owner.business,destination,owner.epoch,owner.actor,ops[1].operation_id]);
    const firstClaims=await Promise.all([claim(),claim(rival)]);
    assert.deepEqual(firstClaims.map(x=>x.state).sort(),['busy','claimed']);
    const firstClaim=firstClaims.find(x=>x.state==='claimed');
    assert.equal(firstClaim.version,'1');
    const opened=await credentialStore.open(binding(owner,destination,'1',id,'1'),firstClaim,transport.openRetained);
    assert.equal(opened.forPrivateCredentialStore().refreshToken,'fictional-refresh-1');
    const second=await sealed(owner,destination,'1',id,'2');
    assert.equal(await finish(firstClaim.claimId,'rotated',credentialKey,first),null);
    assert.deepEqual(await finish(firstClaim.claimId,'rotated',credentialKey,second),{state:'rotated'});
    assert.equal(await finish(firstClaim.claimId,'rotated',credentialKey,second),null);
    const secondClaim=await claim();
    assert.equal(secondClaim.version,'2');
    assert.deepEqual(secondClaim.envelope,second);
    const rotated=await credentialStore.open(binding(owner,destination,'1',id,'2'),secondClaim,transport.openRetained);
    assert.equal(rotated.forPrivateCredentialStore().accessToken,'fictional-access-2');
    await assert.rejects(credentialStore.open(binding(owner,destination,'1',id,'1'),secondClaim,transport.openRetained),
      {message:'GOOGLE_CALENDAR_OAUTH_FAILED'});
    assert.deepEqual(await claim(rival),{state:'busy'});

    await admin.query('BEGIN');
    try{
      await admin.query('ALTER TABLE crest_private.google_calendar_refresh_claims DISABLE TRIGGER calendar_credentials_retained');
      await admin.query(`UPDATE crest_private.google_calendar_refresh_claims SET admitted_at=admitted_at-interval '31 seconds',
        deadline=deadline-interval '31 seconds' WHERE id=$1`,[secondClaim.claimId]);
      await admin.query('ALTER TABLE crest_private.google_calendar_refresh_claims ENABLE TRIGGER calendar_credentials_retained');
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}
    assert.deepEqual(await claim(rival),{state:'uncertain'});
    assert.equal(await finish(secondClaim.claimId,'rotated',credentialKey,await sealed(owner,destination,'1',id,'3')),null);
    assert.deepEqual(await finish(secondClaim.claimId,'uncertain'),{state:'uncertain'});
    assert.deepEqual(await claim(),{state:'uncertain'});
    const {rows:[stored]}=await admin.query('SELECT to_jsonb(c) AS credential FROM crest_private.google_calendar_credentials c WHERE id=$1',[id]);
    assert.equal(JSON.stringify(stored).includes('fictional-refresh-'),false);
    assert.deepEqual(stored.credential.envelope,second);

    const disconnected=await call(oauth,'begin_google_calendar_disconnect',[...auth(owner),destination,'1',randomUUID()]);
    assert.equal(disconnected.generation,'2');
    assert.equal(await claim(),null);
    assert.equal(await finish(secondClaim.claimId,'uncertain'),null);
    const whileRevoking=await start({...browserOwner,connectionGeneration:'2'});
    assert.equal((await protocol.callback(whileRevoking.request,{...browserOwner,connectionGeneration:'2'},signal)).state,'exchange_pending');
    assert.equal(await admit(whileRevoking.id,oauth,owner,'2'),null);

    // Exercise the actual held callback composition over committed PostgreSQL
    // calls. Provider I/O is replaced by one synthetic response.
    const foreignDestination=randomUUID(),foreignOps=await operations(foreign);
    await admin.query(`INSERT INTO crest.google_calendar_destinations(id,business_id,provider_calendar_id,created_by,operation_id)
      VALUES($1,$2,'other-fixture-only@group.calendar.google.com',$3,$4)`,[foreignDestination,foreign.business,foreign.actor,foreignOps[0].operation_id]);
    const [credentialHash,appSessionId,actorId,authIssuer,authSubject,authProviderSessionId,providerDeadline]=foreign.auth();
    const foreignAuthority={businessId:foreign.business,recoveryEpoch:foreign.epoch,connectionGeneration:'0',
      credentialHash,appSessionId,actorId,authIssuer,authSubject,authProviderSessionId,providerValidUntil:providerDeadline.getTime()};
    const sequence=[];let tokenCalls=0,calendarReads=0;
    const calendarOwner='reviewed-owner@example.com', providerCalendarId='other-fixture-only@group.calendar.google.com';
    function callbackService(connection){
      return createGoogleCalendarConnection({clientId:client,callbackUri:callback,clientSecret:'fictional-client-secret',
        verifierKeyId:verifierKey,credentialKeyId:credentialKey,calendarKeyMaterial:secret,
        async committedQuery(sql,args){
          assert(!JSON.stringify(args).includes('fictional-issued-refresh'));
          assert(!JSON.stringify(args).includes('fictional/client-code'));
          const result=(await connection.query(sql,args)).rows[0].result;
          sequence.push(sql.split('crest_commands.')[1].split('(')[0]);
          return result;
        },
        async request(url,init){
          if(init.method==='GET'){
            calendarReads++;
            assert.equal(url,'https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(providerCalendarId)+'?fields=kind,id,summary,dataOwner');
            assert.equal(init.headers.authorization,'Bearer fictional-issued-access');
            const {rows}=await admin.query("SELECT count(*)::int AS n FROM crest.google_calendar_request_admissions WHERE business_id=$1 AND kind='verify_setup_destination'",
              [foreign.business]);
            assert.equal(rows[0].n,1);
            sequence.push('destination');
            return Response.json({kind:'calendar#calendar',id:providerCalendarId,summary:'Crest Jobs',dataOwner:calendarOwner});
          }
          tokenCalls++;
          assert.equal(url,'https://oauth2.googleapis.com/token');
          assert.equal(init.redirect,'error');
          assert.equal(init.body.get('code'),'fictional/client-code');
          assert.match(init.body.get('code_verifier'),/^[A-Za-z0-9_-]{43}$/);
          const count=await admin.query('SELECT count(*)::int AS n FROM crest_private.google_calendar_code_exchanges WHERE business_id=$1',[foreign.business]);
          assert.equal(count.rows[0].n,1);
          sequence.push('provider');
          return Response.json({access_token:'fictional-issued-access',refresh_token:'fictional-issued-refresh',
            scope,token_type:'Bearer',expires_in:3600});
        }});
    }
    const flow=await callbackService(oauth),rivalFlow=await callbackService(rivalOAuth);
    assert.equal(await flow.confirmDestination(foreignAuthority,{destinationId:foreignDestination,providerCalendarId,
      reviewedCalendarOwner:calendarOwner,confirmed:true},signal),true);
    const redirect=await flow.begin(foreignAuthority,signal);
    const state=new URL(redirect.headers.get('Location')).searchParams.get('state');
    const callbackRequest=new Request(callback+'?'+new URLSearchParams({state,code:'fictional/client-code'}));
    const callbacks=await Promise.all([flow.callback(callbackRequest,foreignAuthority,signal),
      rivalFlow.callback(callbackRequest,foreignAuthority,signal)]);
    assert.deepEqual(callbacks.map(result=>result.state).sort(),['restart','staged']);
    assert.equal(tokenCalls,1);
    assert.equal(calendarReads,1);
    assert(sequence.indexOf('admit_google_calendar_code_exchange')<sequence.indexOf('provider'));
    assert(sequence.indexOf('provider')<sequence.indexOf('admit_google_calendar_setup_destination'));
    assert(sequence.indexOf('admit_google_calendar_setup_destination')<sequence.indexOf('destination'));
    assert(sequence.indexOf('destination')<sequence.indexOf('finish_google_calendar_setup_destination'));
    assert(sequence.indexOf('finish_google_calendar_setup_destination')<sequence.indexOf('stage_google_calendar_credential'));
    assert.deepEqual(await flow.callback(callbackRequest,foreignAuthority,signal),{state:'restart'});
    const staged=callbacks.find(result=>result.state==='staged');
    assert.equal(staged.generation,'1');
    const foreignBoundary=[foreign.business,foreignDestination,foreign.epoch,'1'];
    assert.equal(await call(other,'claim_google_calendar_refresh',foreignBoundary),null);
    const stagedGrant=(await admin.query('SELECT key_id AS "keyId",envelope FROM crest_private.google_calendar_credentials WHERE id=$1',
      [staged.credentialId])).rows[0];
    const restored=await credentialStore.open(binding(foreign,foreignDestination,'1',staged.credentialId,'1'),stagedGrant,transport.openRetained);
    assert.equal(restored.forPrivateCredentialStore().refreshToken,'fictional-issued-refresh');

    // A previously admitted refresh must contribute to disconnect's drain,
    // even when there was no Calendar event request in flight.
    await admin.query(`INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
      client_name,service_label,work_address,created_by,operation_id) VALUES($1,$2,1,$3,'active',false,false,false,$4,$5)`,
      [foreign.business,foreignDestination,foreign.epoch,foreign.actor,foreignOps[1].operation_id]);
    const stillRefreshing=await call(other,'claim_google_calendar_refresh',foreignBoundary);
    const scheduled=confirmedBookingRequest(foreign);
    assert.equal((await call(web,'book_job',[...auth(foreign),scheduled.operationId,1,scheduled.jobId,scheduled.expectedModeSequence,scheduled.payload])).state,'committed');
    const eventScope=[foreign.business,foreignDestination,scheduled.jobId,'1',foreign.epoch];
    const eventLease=await call(other,'claim_google_calendar_dispatch',eventScope);
    assert.equal(eventLease.state,'leased');
    // Two setup reads were admitted above. Add 58 synthetic worker reads;
    // a real worker admission must observe the combined minute cap.
    await admin.query(`INSERT INTO crest.google_calendar_request_admissions(business_id,lease_id,kind,admitted_at)
      SELECT $1,$2,'read_event',clock_timestamp() FROM generate_series(1,58)`,[foreign.business,eventLease.leaseId]);
    assert.deepEqual(await call(other,'admit_google_calendar_request',[...eventScope,eventLease.leaseId,'read_event']),{state:'delayed'});
    // Mark this synthetic read lease settled so it cannot mask the separate
    // refresh deadline in the disconnect assertion below.
    await admin.query(`INSERT INTO crest.google_calendar_dispatch_results(business_id,lease_id,outcome,source_current,recorded_at,retry_at)
      SELECT $1,$2,'delayed',true,s,s FROM (SELECT clock_timestamp() AS s) stamp`,[foreign.business,eventLease.leaseId]);
    const otherDisconnect=await call(oauth,'begin_google_calendar_disconnect',[...auth(foreign),foreignDestination,'1',randomUUID()]);
    assert.equal(Date.parse(otherDisconnect.drainUntil),Date.parse(stillRefreshing.deadline));
    const revocation=await call(oauth,'google_calendar_disconnect_status',[...auth(foreign),foreignDestination,otherDisconnect.disconnectId,'admit',randomUUID()]);
    assert.equal(revocation.state,'draining');
    assert.equal(await call(other,'finish_google_calendar_refresh',[...foreignBoundary,stillRefreshing.claimId,'uncertain',null,null]),null);

    await admin.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',
      [owner.business,randomUUID()]);
    assert.equal(await claim(),null);
    await assert.rejects(admin.query('DELETE FROM crest_private.google_calendar_refresh_results'),{code:'55000'});
  }finally{
    try{await sandbox?.close();}finally{await cluster.close();}
  }
});
