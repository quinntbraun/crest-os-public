import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createGoogleCalendarOAuth, googleCalendarOAuthIssuer, googleCalendarOAuthScope } from '../../src/operations/google-calendar-oauth.ts';
import { createGoogleCalendarOAuthTransport } from '../../src/operations/google-calendar-oauth-transport.ts';
import { createGoogleCalendarSecondaryCreator } from '../../src/operations/google-calendar-destination-creation.ts';
import { createGoogleCalendarConnection } from '../../src/operations/google-calendar-connection.ts';
import { googleCalendarConsentDatabase, googleCalendarConsentStatements, googleCalendarSetupStatements,
  syntheticGoogleCalendarSetupDatabase } from '../../src/operations/google-calendar-database.ts';
import { createGoogleCalendarCredentialStore } from '../../src/operations/google-calendar-credential-store.ts';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { recoveryCluster } from '../support/recovery-drill.mjs';

async function call(connection, command, args) {
  const parameters=args.map((_,index)=>'$'+(index+1)).join(',');
  return (await connection.query('SELECT crest_commands.'+command+'('+parameters+') AS result',args)).rows[0].result;
}

const client='fictional-crest.apps.googleusercontent.com', callback='https://crest.example.com/api/google-calendar/callback';
const keyId='fictional-pkce-key', expectedOwner='reviewed-owner@example.com', signal=new AbortController().signal;

test('one confirmed Calendar creation binds provider-assigned identity and cannot retry a lost outcome', {timeout:120000}, async()=>{
  const cluster=await recoveryCluster();
  let sandbox;
  try{
    sandbox=await migrationSandbox(cluster.testDatabaseUrl);
    const database=await sandbox.database(),admin=await sandbox.connect(database);
    await sandbox.apply(database,await sandbox.prefix(0),true);
    await installProviderSchema(admin,database);
    await sandbox.apply(database,await sandbox.prefix(82,true));
    await admin.query('BEGIN');
    try{
      for(const proposal of ['outbox','dispatch','oauth-attempt','disconnect','credentials','destination-creation','initial-consent','setup-state']) await admin.query(await readFile(
        new URL('../../planning/proposals/google-calendar-'+proposal+'.sql',import.meta.url),'utf8'));
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}
    const consentPassword=randomBytes(32).toString('hex');
    await admin.query(`CREATE ROLE calendar_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${consentPassword}'`);
    await admin.query('GRANT crest_calendar_oauth TO calendar_test_login WITH INHERIT FALSE, SET TRUE');
    const consentUrl=new URL(database);
    consentUrl.username='calendar_test_login';
    consentUrl.password=consentPassword;
    const consentDatabase=googleCalendarConsentDatabase({connectionString:consentUrl.toString(),environment:'test'});
    const setupDatabase=syntheticGoogleCalendarSetupDatabase({connectionString:consentUrl.toString(),environment:'test'});
    const adminDatabase=googleCalendarConsentDatabase({connectionString:database,environment:'test'});
    const databaseFailure={message:'GOOGLE_CALENDAR_DATABASE_FAILED'};
    await assert.rejects(consentDatabase('SELECT 1',[],signal),databaseFailure);
    await assert.rejects(consentDatabase(googleCalendarSetupStatements.state,Array(9).fill(null),signal),databaseFailure);
    assert.throws(()=>syntheticGoogleCalendarSetupDatabase({connectionString:consentUrl.toString(),environment:'production'}),
      {message:'GOOGLE_CALENDAR_DATABASE_CONFIGURATION_REQUIRED'});
    await assert.rejects(consentDatabase(googleCalendarConsentStatements.lookup,[],signal),databaseFailure);
    await assert.rejects(consentDatabase(googleCalendarConsentStatements.lookup,Array(12).fill(null),AbortSignal.abort()),databaseFailure);
    await assert.rejects(adminDatabase(googleCalendarConsentStatements.lookup,Array(12).fill(null),signal),databaseFailure);
    const web=await sandbox.connect(database);
    await web.query('SET ROLE crest_web');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const fixture=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await fixture(),foreign=await fixture(),wrong=await fixture(),promotedOwner=await fixture();
    const followup=await fixture(promotedOwner);
    const oauth=await sandbox.connect(database),rival=await sandbox.connect(database);
    await oauth.query('SET ROLE crest_calendar_oauth');
    await rival.query('SET ROLE crest_calendar_oauth');
    await admin.query('INSERT INTO crest_private.google_calendar_oauth_client VALUES(true,$1,$2,$3,$4)',
      [googleCalendarOAuthIssuer,client,callback,keyId]);
    const grantKey='fictional-calendar-grant',calendarKeyMaterial=randomBytes(32);
    await admin.query('INSERT INTO crest_private.google_calendar_credential_key VALUES(true,$1)',[grantKey]);
    const identity=principal=>[...principal.auth(),principal.epoch];
    const scope=principal=>[...identity(principal),googleCalendarOAuthIssuer,client,callback];
    const context=principal=>({businessId:principal.business,actorId:principal.actor,appSessionId:principal.session,
      recoveryEpoch:principal.epoch,connectionGeneration:'0'});
    function services(principal,connection=oauth){
      const boundary=scope(principal),protocolBoundary=[...identity(principal),'0',googleCalendarOAuthIssuer,client,callback];
      return {
        protocol:createGoogleCalendarOAuth({clientId:client,callbackUri:callback,verifierKeyId:keyId,calendarKeyMaterial:randomBytes(32),
          store:{
            begin:(v)=>call(connection,'begin_google_calendar_oauth_attempt',[...protocolBoundary,v.attemptId,v.stateDigest,v.verifierKeyId,v.verifierEnvelope]),
            consume:(v)=>call(connection,'consume_google_calendar_oauth_attempt',[...protocolBoundary,v.attemptId,v.stateDigest]),
          }}),
        confirm:(attempt,approved)=>call(connection,'confirm_google_calendar_creation',[...boundary,attempt,expectedOwner,approved]),
        exchange:(attempt)=>call(connection,'admit_google_calendar_creation_exchange',[...boundary,attempt]),
        admit:(attempt)=>call(connection,'admit_google_calendar_secondary_creation',[...boundary,attempt]),
        finish:(attempt,outcome)=>call(connection,'finish_google_calendar_secondary_creation',[...boundary,attempt,
          outcome.state,outcome.providerCalendarId??null,outcome.observedGoogleOwner??null,outcome.marker??null]),
      };
    }
    async function pending(principal,service){
      const protocol=await service.protocol;
      const redirect=await protocol.begin(context(principal),signal);
      const state=new URL(redirect.headers.get('Location')).searchParams.get('state');
      return {attempt:state.split('.')[0],callback:new Request(callback+'?'+new URLSearchParams({state,code:'fictional/auth-code'})),protocol};
    }
    async function consentAndExchange(principal,service,prepared){
      assert.equal(await service.confirm(prepared.attempt,true),true);
      const parsed=await prepared.protocol.callback(prepared.callback,context(principal),signal);
      assert.equal(parsed.state,'exchange_pending');
      const transport=createGoogleCalendarOAuthTransport({clientId:client,callbackUri:callback,clientSecret:'fictional-secret',
        async admit({kind,attemptId}){
          assert.equal(kind,'exchange');
          return (await service.exchange(attemptId))?.attemptId===attemptId;
        },
        async request(url,options){
          assert.equal(url,'https://oauth2.googleapis.com/token');
          assert.equal(options.body.get('code'),'fictional/auth-code');
          return Response.json({access_token:'fictional-access',refresh_token:'fictional-refresh',scope:googleCalendarOAuthScope,token_type:'Bearer',expires_in:3600});
        }});
      const exchanged=await transport.exchange(parsed.exchange,signal);
      assert.equal(exchanged.state,'granted');
      return exchanged.grant;
    }
    const approved=services(owner),other=services(foreign),ownerRival=services(owner,rival);
    const first=await pending(owner,approved);
    assert.equal(await approved.confirm(first.attempt,false),false);
    assert.equal(await approved.exchange(first.attempt),null);
    assert.equal(await approved.admit(first.attempt),null);
    assert.equal(await other.confirm(first.attempt,true),false);
    await assert.rejects(services(owner,web).confirm(first.attempt,true),{code:'42501'});
    const grant=await consentAndExchange(owner,approved,first);
    let providerCalls=0;
    const providerId='created-fixture@group.calendar.google.com';
    function creator(service,behavior='correct'){
      return createGoogleCalendarSecondaryCreator({admit:service.admit,finish:service.finish,
        async request(url,init){
          providerCalls++;
          assert.equal(url,'https://www.googleapis.com/calendar/v3/calendars?fields=kind,id,summary,description,dataOwner');
          assert.equal(init.method,'POST');
          assert.equal(init.redirect,'error');
          const body=JSON.parse(init.body);
          assert.deepEqual(Object.keys(body).sort(),['description','summary']);
          assert.equal(body.summary,'Crest Jobs');
          assert.match(body.description,/^Crest OS calendar reference [a-f0-9-]{36}$/);
          if(behavior==='lost') throw Error('fictional network response lost');
          return Response.json({kind:'calendar#calendar',id:providerId,summary:body.summary,description:body.description,
            dataOwner:behavior==='wrong'?'wrong@example.com':expectedOwner});
        }});
    }
    const results=await Promise.all([creator(approved)(first.attempt,grant,signal),creator(ownerRival)(first.attempt,grant,signal)]);
    assert.deepEqual(results.map(result=>result.state).sort(),['created','paused']);
    assert.equal(providerCalls,1);
    const proof=(await admin.query('SELECT outcome,provider_calendar_id FROM crest_private.google_calendar_creation_results WHERE business_id=$1',[owner.business])).rows[0];
    assert.deepEqual(proof,{outcome:'created',provider_calendar_id:providerId});
    assert.equal(await approved.admit(first.attempt),null);
    assert.equal(await approved.finish(first.attempt,{state:'uncertain'}),false);
    assert.equal(await other.admit(first.attempt),null);
    const absent=await admin.query('SELECT count(*)::int AS n FROM crest.google_calendar_destinations');
    assert.equal(absent.rows[0].n,0);

    const second=await pending(foreign,other),foreignGrant=await consentAndExchange(foreign,other,second);
    assert.deepEqual(await creator(other,'lost')(second.attempt,foreignGrant,signal),{state:'uncertain'});
    assert.deepEqual(await creator(other)(second.attempt,foreignGrant,signal),{state:'paused'});
    const later=await pending(foreign,other);
    assert.equal(await other.confirm(later.attempt,true),false);
    const lost=(await admin.query('SELECT outcome,provider_calendar_id FROM crest_private.google_calendar_creation_results WHERE business_id=$1',[foreign.business])).rows[0];
    assert.deepEqual(lost,{outcome:'uncertain',provider_calendar_id:null});
    assert.equal(await call(oauth,'promote_google_calendar_initial_destination',
      [...scope(foreign),second.attempt,randomUUID(),randomUUID(),grantKey,{}]),null);

    const mismatch=services(wrong),third=await pending(wrong,mismatch),wrongGrant=await consentAndExchange(wrong,mismatch,third);
    assert.deepEqual(await creator(mismatch,'wrong')(third.attempt,wrongGrant,signal),{state:'review'});
    const rejected=(await admin.query('SELECT outcome,provider_calendar_id FROM crest_private.google_calendar_creation_results WHERE business_id=$1',[wrong.business])).rows[0];
    assert.deepEqual(rejected,{outcome:'review',provider_calendar_id:null});
    assert.equal(providerCalls,3);

    const [credentialHash,appSessionId,actorId,authIssuer,authSubject,authProviderSessionId,providerDeadline]=promotedOwner.auth();
    const ownerEvidence={...context(promotedOwner),credentialHash,appSessionId,actorId,authIssuer,authSubject,authProviderSessionId,
      providerValidUntil:providerDeadline.getTime()};
    let tokenRequests=0,creationRequests=0;
    const promotedProviderId='promoted-fixture@group.calendar.google.com';
    const lifecycle=await createGoogleCalendarConnection({clientId:client,callbackUri:callback,clientSecret:'fictional-secret',
      verifierKeyId:keyId,credentialKeyId:grantKey,calendarKeyMaterial,
      async committedQuery(sql,values,requestSignal){
        if(Object.values(googleCalendarConsentStatements).includes(sql))return consentDatabase(sql,values,requestSignal);
        if(Object.values(googleCalendarSetupStatements).includes(sql))return setupDatabase(sql,values,requestSignal);
        return (await oauth.query(sql,values)).rows[0].result;
      },
      async request(url,init){
        if(url==='https://oauth2.googleapis.com/token'){
          tokenRequests++;
          return Response.json({access_token:'exact-creation-access',refresh_token:'exact-creation-refresh',scope:googleCalendarOAuthScope,
            token_type:'Bearer',expires_in:3600});
        }
        creationRequests++;
        assert.equal(url,'https://www.googleapis.com/calendar/v3/calendars?fields=kind,id,summary,description,dataOwner');
        assert.equal(init.headers.authorization,'Bearer exact-creation-access');
        const body=JSON.parse(init.body);
        return Response.json({kind:'calendar#calendar',id:promotedProviderId,summary:body.summary,description:body.description,dataOwner:expectedOwner});
      }});
    async function browserCallback(){
      const response=await lifecycle.begin(ownerEvidence,signal);
      const state=new URL(response.headers.get('Location')).searchParams.get('state');
      return {id:state.split('.')[0],request:new Request(callback+'?'+new URLSearchParams({state,code:'fictional/create-code'}))};
    }
    assert.deepEqual(await lifecycle.setupState(ownerEvidence,signal),{schemaVersion:1,state:'ready'});
    await assert.rejects(lifecycle.setupState({...ownerEvidence,recoveryEpoch:randomUUID()},signal),databaseFailure);
    await assert.rejects(web.query(googleCalendarSetupStatements.state,identity(promotedOwner)),{code:'42501'});
    const unconfirmed=await browserCallback();
    assert.deepEqual(await lifecycle.initialCreationCallback(unconfirmed.request,ownerEvidence,signal),{state:'restart'});
    assert.equal(tokenRequests,0);
    const verified=await browserCallback();
    assert.equal(await lifecycle.confirmCreation(ownerEvidence,verified.id,expectedOwner,true,signal),true);
    const promoted=await lifecycle.initialCreationCallback(verified.request,ownerEvidence,signal);
    assert.equal(promoted.state,'staged');
    assert.equal(tokenRequests,1);
    assert.equal(creationRequests,1);
    const persisted=(await admin.query(`SELECT d.id,d.provider_calendar_id,c.envelope,c.key_id AS "keyId",c.source_exchange,
      (SELECT count(*)::int FROM crest.google_calendar_consents s WHERE s.business_id=d.business_id) AS consents,
      (SELECT count(*)::int FROM crest_private.audit_events a WHERE a.business_id=d.business_id AND a.operation_id=d.operation_id
       AND a.action='stage_creation') AS audits
     FROM crest.google_calendar_destinations d JOIN crest_private.google_calendar_credentials c
      ON (c.business_id,c.destination_id)=(d.business_id,d.id) WHERE (d.business_id,c.id)=($1,$2)`,
    [promotedOwner.business,promoted.credentialId])).rows[0];
    assert.equal(persisted.provider_calendar_id,promotedProviderId);
    assert.equal(persisted.source_exchange,verified.id);
    assert.equal(persisted.consents,0);
    assert.equal(persisted.audits,1);
    assert.deepEqual(await lifecycle.setupState(ownerEvidence,signal),{schemaVersion:1,state:'staged',
      destinationId:persisted.id,credentialId:promoted.credentialId,recoveryEpoch:promotedOwner.epoch});
    const followSession=randomUUID(),followProvider=randomUUID(),followHash=randomBytes(32);
    await admin.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",
      [followProvider,authSubject]);
    await admin.query(`WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp)
      INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,
       last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by)
      SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id
      FROM crest_private.actors CROSS JOIN observed WHERE id=$2`,[followSession,actorId,followProvider,followHash,randomBytes(32)]);
    const followEvidence={...ownerEvidence,credentialHash:followHash,appSessionId:followSession,authProviderSessionId:followProvider};
    assert.deepEqual(await lifecycle.setupState(followEvidence,signal),{schemaVersion:1,state:'review'});
    const seal=await createGoogleCalendarCredentialStore({activeKeyId:grantKey,calendarKeyMaterial});
    const reader=createGoogleCalendarOAuthTransport({clientId:client,callbackUri:callback,clientSecret:'fictional-secret',
      admit:async()=>false,request:async()=>{throw Error('Test only');}});
    const opened=await seal.open({businessId:promotedOwner.business,destinationId:persisted.id,connectionGeneration:'1',
      recoveryEpoch:promotedOwner.epoch,clientId:client,credentialId:promoted.credentialId,version:'1'},persisted,reader.openRetained);
    assert.equal(opened.forPrivateCredentialStore().refreshToken,'exact-creation-refresh');
    assert.deepEqual(await lifecycle.initialCreationCallback(verified.request,ownerEvidence,signal),{state:'restart'});
    const laterGrant=await browserCallback();
    assert.equal(await lifecycle.confirmDestination(ownerEvidence,{destinationId:persisted.id,providerCalendarId:promotedProviderId,
      reviewedCalendarOwner:expectedOwner,confirmed:true},signal),false);
    assert.deepEqual(await lifecycle.callback(laterGrant.request,ownerEvidence,signal),{state:'restart'});
    assert.equal(tokenRequests,1);
    assert.equal(creationRequests,1);

    const book=(principal,job)=>call(web,'book_job',[...principal.auth(),principal.epoch,job.operationId,1,job.jobId,job.expectedModeSequence,job.payload]);
    const queued=async()=>(await admin.query('SELECT job_id FROM crest.google_calendar_outbox WHERE business_id=$1 ORDER BY job_id',
      [promotedOwner.business])).rows.map(row=>row.job_id);
    const beforeConsent=confirmedBookingRequest(promotedOwner),afterConsent=confirmedBookingRequest(followup);
    afterConsent.expectedModeSequence='1';
    afterConsent.payload.appointment.start_at='2026-11-04T10:00:00.123456Z';
    afterConsent.payload.appointment.end_at='2026-11-04T11:00:00.123456Z';
    afterConsent.payload.appointment.local_start='2026-11-04T10:00:00.123456';
    afterConsent.payload.appointment.local_end='2026-11-04T11:00:00.123456';
    assert.equal((await book(promotedOwner,beforeConsent)).state,'committed');
    assert.deepEqual(await queued(),[]);
    const minimal={clientName:false,serviceLabel:false,workAddress:false};
    const chosen={...minimal,serviceLabel:true};
    const probe=[...identity(promotedOwner),persisted.id,promoted.credentialId,randomUUID(),false,false,false];
    await admin.query('GRANT crest_web TO calendar_test_login');
    await assert.rejects(consentDatabase(googleCalendarConsentStatements.prepare,probe,signal),databaseFailure);
    await admin.query('REVOKE crest_web FROM calendar_test_login');
    await admin.query('GRANT crest_calendar_oauth TO calendar_test_login WITH ADMIN TRUE');
    await assert.rejects(consentDatabase(googleCalendarConsentStatements.prepare,probe,signal),databaseFailure);
    await admin.query('REVOKE ADMIN OPTION FOR crest_calendar_oauth FROM calendar_test_login');
    await admin.query('BEGIN');
    try{
      await admin.query('SELECT id FROM crest.google_calendar_destinations WHERE id=$1 FOR UPDATE',[persisted.id]);
      await assert.rejects(consentDatabase(googleCalendarConsentStatements.prepare,probe,AbortSignal.timeout(200)),databaseFailure);
    }finally{await admin.query('ROLLBACK');}
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest_private.google_calendar_initial_consent_reviews')).rows[0].n,0);
    assert.equal(await lifecycle.prepareConsent(ownerEvidence,persisted.id,randomUUID(),minimal,signal),null);
    const preview=await lifecycle.prepareConsent(ownerEvidence,persisted.id,promoted.credentialId,minimal,signal);
    assert.equal(preview.calendarName,'Crest Jobs');
    assert.equal(preview.googleOwner,expectedOwner);
    assert.equal(preview.providerCalendarId,promotedProviderId);
    assert.equal(preview.example.summary,'Crest job');
    assert.equal(preview.example.location,undefined);
    assert.equal(preview.example.reminders.useDefault,false);
    assert.match(preview.sharingReview,/access permissions/);
    assert.match(preview.notificationReview,/lock-screen previews/);
    const reviewed=await lifecycle.prepareConsent(ownerEvidence,persisted.id,promoted.credentialId,chosen,signal);
    assert.equal(reviewed.example.summary,'Crest job · Sample Detail');
    assert.equal(reviewed.example.location,undefined);
    assert(!JSON.stringify(reviewed).includes('Sample Client'));
    const selection={destinationId:persisted.id,credentialId:promoted.credentialId,reviewId:reviewed.reviewId,disclosure:chosen,
      payloadReviewed:true,sharingReviewed:true,notificationsReviewed:true};
    assert.deepEqual(await lifecycle.lookupConsent(ownerEvidence,persisted.id,promoted.credentialId,reviewed.reviewId,signal),{state:'absent'});
    assert.equal(await lifecycle.lookupConsent(ownerEvidence,persisted.id,promoted.credentialId,randomUUID(),signal),null);
    assert.equal(await lifecycle.confirmConsent(ownerEvidence,{...selection,sharingReviewed:false},signal),null);
    assert.equal(await lifecycle.confirmConsent(ownerEvidence,{...selection,notificationsReviewed:false},signal),null);
    assert.equal(await lifecycle.confirmConsent(ownerEvidence,{...selection,disclosure:{...chosen,workAddress:true}},signal),null);
    assert.equal(await lifecycle.confirmConsent(ownerEvidence,{...selection,reviewId:randomUUID()},signal),null);
    assert.equal(await lifecycle.confirmConsent({...ownerEvidence,appSessionId:randomUUID()},selection,signal),null);
    assert.deepEqual(await queued(),[]);
    const consent=await lifecycle.confirmConsent(ownerEvidence,selection,signal);
    assert.equal(consent.state,'active');
    assert.equal(consent.generation,'1');
    assert.deepEqual(await lifecycle.setupState(ownerEvidence,signal),{schemaVersion:1,state:'active',
      destinationId:persisted.id,credentialId:promoted.credentialId,recoveryEpoch:promotedOwner.epoch});
    assert.deepEqual(await lifecycle.setupState(followEvidence,signal),{schemaVersion:1,state:'active'});
    assert.deepEqual(await lifecycle.lookupConsent(ownerEvidence,persisted.id,promoted.credentialId,reviewed.reviewId,signal),consent);
    assert.equal(await lifecycle.confirmConsent(ownerEvidence,selection,signal),null);
    assert.deepEqual(await queued(),[]);
    const nextBooked=await book(followup,afterConsent);
    assert.equal(nextBooked.state,'committed',JSON.stringify(nextBooked));
    assert.deepEqual(await queued(),[afterConsent.jobId]);
    const consentRow=(await admin.query('SELECT state,client_name,service_label,work_address FROM crest.google_calendar_consents WHERE id=$1',[consent.consentId])).rows[0];
    assert.deepEqual(consentRow,{state:'active',client_name:false,service_label:true,work_address:false});
    const audit=(await admin.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2 AND action='activate'",
      [promotedOwner.business,reviewed.reviewId])).rows[0].delta;
    assert.deepEqual(audit.after.disclosure,chosen);
    assert.equal(audit.after.sharingReviewed,true);
    assert.equal(audit.after.notificationsReviewed,true);
    await call(oauth,'begin_google_calendar_disconnect',[...identity(promotedOwner),persisted.id,'1',randomUUID()]);
    assert.deepEqual(await lifecycle.setupState(ownerEvidence,signal),{schemaVersion:1,state:'review'});
    assert.deepEqual(await lifecycle.lookupConsent(ownerEvidence,persisted.id,promoted.credentialId,reviewed.reviewId,signal),{state:'changed'});
    assert.equal(tokenRequests,1);
    assert.equal(creationRequests,1);
    await assert.rejects(oauth.query('SELECT * FROM crest_private.google_calendar_creation_intents'),{code:'42501'});
    await assert.rejects(admin.query('DELETE FROM crest_private.google_calendar_creation_results'),{code:'55000'});
    await admin.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',[foreign.business,randomUUID()]);
    await assert.rejects(other.admit(second.attempt),{message:'RECOVERY_REVIEW_REQUIRED'});
  }finally{
    try{await sandbox?.close();}finally{await cluster.close();}
  }
});
