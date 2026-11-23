import assert from 'node:assert/strict';
import { randomBytes, randomUUID,createHash } from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {strFromU8,unzipSync} from 'fflate';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createGoogleCalendarOAuth, googleCalendarOAuthIssuer, googleCalendarOAuthScope } from '../../src/operations/google-calendar-oauth.ts';
import { createGoogleCalendarCredentialStore } from '../../src/operations/google-calendar-credential-store.ts';
import { createGoogleCalendarConnection } from '../../src/operations/google-calendar-connection.ts';
import {createGoogleCalendarRefresh} from '../../src/operations/google-calendar-refresh.ts';
import {captureGoogleCalendarPortableSource} from '../../src/operations/google-calendar-portable-source.ts';
import {readSourceExportCsv} from '../../src/security/source-export-csv-reader.ts';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';
import {createServiceRefundSourceCollector,createCurrentBusinessSourceCollector} from '../../src/security/business-foundation-collector.ts';
import {readCurrentBusinessCsv} from '../../src/security/current-business-source-csv.ts';
import {formatCurrentBusinessPortableSource} from '../../src/security/current-business-portable-source.ts';
import {createCurrentBusinessExportWorker} from '../../src/security/business-source-export-worker.ts';
import {parseSourceExportAdmission} from '../../src/security/source-export-admission.ts';
import {createSourceExportDownloadReader} from '../../src/security/source-export-download-reader.ts';
import {parseSourceExportDownloadCatalogue} from '../../src/security/source-export-download-contract.ts';
import {sourceExportDownloadPermitRecord,parseSourceExportDownloadPermit} from '../../src/security/source-export-download-permit.ts';
import {readCurrentSourceLogicalFiles,readCurrentSourceLogicalSelection} from '../../src/client/current-source-logical-files.ts';
import {custodyFixture} from '../support/source-export-custody-fixture.mjs';
import {parseSourceExportStopCommand,parseSourceExportStopOutcome} from '../../src/security/source-export-stop-contract.ts';
import {captureCurrentIdentitySource} from '../../src/security/current-business-identity-source.ts';
import {captureCurrentBusinessRows} from '../../src/security/current-business-source.ts';
import {captureCurrentSessionSource} from '../../src/security/current-business-session-source.ts';
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

for(const registered of [false,125,126,127,128,130,131,132,133,134,135,136,137,138]) test((registered?'Registered schema '+registered+': ':'')+'Calendar credentials are sealed and refresh admits one worker per active credential version', {timeout:120000}, async()=>{
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
    await sandbox.apply(database,await sandbox.prefix(registered||76));
    if(registered>=131){
      const coverage=JSON.parse(await readFile(new URL(registered<138?'../support/registered'+registered+'-export-coverage.json':'../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8'));
      const observed=(await admin.query("SELECT n.nspname||'.'||c.relname AS table,a.attname AS column FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN('crest','crest_private') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2")).rows;
      const checked=verifyExportCoverage(coverage,observed,registered);assert.equal(checked.assurance,'schema_inventory_only');assert.equal(checked.completePortableExport,false);assert.equal(checked.completeBackup,false);
    }
    if(!registered){
    await admin.query('BEGIN');
    try{
      for(const proposal of ['outbox','dispatch','oauth-attempt','disconnect','credentials']) await admin.query(await readFile(
        new URL('../../planning/proposals/google-calendar-'+proposal+'.sql',import.meta.url),'utf8'));
      await admin.query('COMMIT');
    }catch(error){await admin.query('ROLLBACK');throw error;}
    }
    const web=await sandbox.connect(database);
    await web.query('SET ROLE crest_web');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const fixture=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await fixture(),foreign=await fixture();let restartingExportBusiness;
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
    const claim=(connection=agent)=>call(connection,registered?'claim_budgeted_google_calendar_refresh':'claim_google_calendar_refresh',boundary);
    const finish=(claimId,outcome,key=null,envelope=null)=>call(agent,'finish_google_calendar_refresh',[...boundary,claimId,outcome,key,envelope]);
    assert.equal(await claim(),null);
    await assert.rejects(claim(other),{message:'GOOGLE_CALENDAR_WORKER_DENIED'});
    await assert.rejects(claim(web),{code:'42501'});
    await assert.rejects(agent.query('SELECT envelope FROM crest_private.google_calendar_credentials'),{code:'42501'});
    await assert.rejects(oauth.query('SELECT envelope FROM crest_private.google_calendar_credentials'),{code:'42501'});
    await admin.query(`INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
      client_name,service_label,work_address,created_by,operation_id) VALUES($1,$2,1,$3,'active',false,false,false,$4,$5)`,
      [owner.business,destination,owner.epoch,owner.actor,ops[1].operation_id]);
    if(registered){
      const budget=await sandbox.connect(database);
      await budget.query('SET ROLE crest_calendar_budget_owner');
      await assert.rejects(budget.query('SELECT envelope FROM crest_private.google_calendar_credentials'),{code:'42501'});
      await assert.rejects(budget.query('SELECT business_id FROM crest_private.google_calendar_code_exchanges'),{code:'42501'});
      await assert.rejects(agent.query('SELECT crest_private.lock_google_calendar_request_budget()'),{code:'42501'});
      const {rows:[role]}=await admin.query(`SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
        (SELECT count(*)::int FROM pg_auth_members WHERE roleid=r.oid OR member=r.oid) AS memberships FROM pg_roles r WHERE rolname='crest_calendar_budget_owner'`);
      assert.deepEqual(role,{rolcanlogin:false,rolinherit:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,memberships:0});
      // Isolated privileged fixture rows verify that refresh admissions share
      // the minute cap with the already committed setup exchange/read. Roll
      // back the fixture transaction; retained production facts are untouched.
      await admin.query('BEGIN');
      try{
        const counts=(await admin.query(`SELECT
          (SELECT count(*) FROM crest.google_calendar_request_admissions WHERE admitted_at>clock_timestamp()-interval '1 minute')+
          (SELECT count(*) FROM crest_private.google_calendar_code_exchanges WHERE admitted_at>clock_timestamp()-interval '1 minute') AS n`)).rows[0];
        assert(Number(counts.n)>0&&Number(counts.n)<60);
        await admin.query(`INSERT INTO crest_private.google_calendar_refresh_claims(business_id,credential_id,credential_version,worker_principal,admitted_at,deadline)
          SELECT $1,$2,1000+n,'synthetic_credential_worker',s,s+interval '30 seconds'
          FROM generate_series(1,$3::int) n CROSS JOIN (SELECT clock_timestamp() AS s) stamp`,[owner.business,id,60-Number(counts.n)]);
        await admin.query('SET LOCAL ROLE crest_calendar_budget_owner');
        assert.equal((await admin.query('SELECT crest_private.lock_google_calendar_request_budget() AS stamp')).rows[0].stamp,null);
      }finally{await admin.query('ROLLBACK');}
    }
    const firstClaims=await Promise.all([claim(),claim(rival)]);
    assert.deepEqual(firstClaims.map(x=>x.state).sort(),['busy','claimed']);
    const firstClaim=firstClaims.find(x=>x.state==='claimed');
    if(registered)assert.equal(firstClaim.admissionVersion,1);
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
    if(registered>=126){
      const [credentialHash,appSessionId,actorId,authIssuer,authSubject,authProviderSessionId,providerDeadline]=owner.auth();
      const authority={businessId:owner.business,recoveryEpoch:owner.epoch,connectionGeneration:'1',credentialHash,appSessionId,actorId,authIssuer,authSubject,authProviderSessionId,providerValidUntil:providerDeadline.getTime()};
      let revocations=0;
      const connection=await createGoogleCalendarConnection({clientId:client,callbackUri:callback,clientSecret:'fictional-client-secret',verifierKeyId:verifierKey,credentialKeyId:credentialKey,calendarKeyMaterial:secret,
        committedQuery:async(sql,args)=>(await oauth.query(sql,args)).rows[0].result,
        async request(url,init){
          assert.equal(url,'https://oauth2.googleapis.com/revoke');
          assert.equal(new URLSearchParams(init.body).get('token'),'fictional-refresh-2');
          const {rows:[admitted]}=await admin.query("SELECT count(*)::int AS n FROM crest.google_calendar_revocation_events WHERE (business_id,disconnect_id,phase)=($1,$2,'admitted')",[owner.business,disconnected.disconnectId]);
          assert.equal(admitted.n,1);revocations++;return new Response(null,{status:200});
        }});
      assert.deepEqual(await connection.connectionStatus(authority,signal),{state:'disconnected',destinationId:destination,generation:'2',disconnectId:disconnected.disconnectId});
      await assert.rejects(call(web,'read_google_calendar_connection',auth(owner)),{code:'42501'});
      assert.equal(await call(oauth,'read_google_calendar_revocation_credential',[...auth(owner),destination,disconnected.disconnectId,randomUUID()]),null);
      assert.equal(await call(oauth,'read_google_calendar_revocation_credential',[...auth(foreign),destination,disconnected.disconnectId,randomUUID()]),null);
      const revoked=await connection.disconnectStatus(authority,destination,disconnected.disconnectId,signal,true);
      assert.equal(revoked.state,'disconnected');assert.equal(revocations,1);
      assert.equal((await connection.disconnectStatus(authority,destination,disconnected.disconnectId,signal,true)).state,'disconnected');
      assert.equal(revocations,1);
      const attempt=(await admin.query("SELECT attempt_id FROM crest.google_calendar_revocation_events WHERE (business_id,disconnect_id,phase)=($1,$2,'admitted')",[owner.business,disconnected.disconnectId])).rows[0].attempt_id;
      assert.equal(await call(oauth,'read_google_calendar_revocation_credential',[...auth(owner),destination,disconnected.disconnectId,attempt]),null);
    }
    if(registered>=127){
      const restarting=await fixture();
      restartingExportBusiness=restarting.business;
      const [credentialHash,appSessionId,actorId,authIssuer,authSubject,authProviderSessionId,providerDeadline]=restarting.auth();
      const browser={businessId:restarting.business,actorId,appSessionId,recoveryEpoch:restarting.epoch,connectionGeneration:'0'};
      const authority={...browser,credentialHash,authIssuer,authSubject,authProviderSessionId,providerValidUntil:providerDeadline.getTime()};
      const service=await createGoogleCalendarConnection({clientId:client,callbackUri:callback,clientSecret:'fictional-secret',verifierKeyId:verifierKey,credentialKeyId:credentialKey,calendarKeyMaterial:secret,budgetedExchanges:true,
        committedQuery:async(sql,args)=>(await oauth.query(sql,args)).rows[0].result,
        request:async()=>{throw Error('Restart fixture must not call a provider');}});
      const first=new URL((await service.begin(authority,signal)).headers.get('location'));
      const firstAttempt=first.searchParams.get('state').split('.')[0];
      assert.equal(await service.confirmCreation(authority,firstAttempt,reviewedOwner,true,signal),true);
      assert.deepEqual(await service.setupState(authority,signal),{schemaVersion:1,state:'authorization_pending',attemptId:firstAttempt});
      const operation=randomUUID();
      await assert.rejects(call(web,'abandon_google_calendar_creation',[...auth(restarting),firstAttempt,operation,true]),{code:'42501'});
      assert.equal(await call(oauth,'abandon_google_calendar_creation',[...auth(foreign),firstAttempt,randomUUID(),true]),null);
      assert.equal(await call(oauth,'abandon_google_calendar_creation',[...auth(restarting),firstAttempt,operation,false]),null);
      const abandoned=await service.abandonCreation(authority,firstAttempt,operation,signal);
      assert.deepEqual(abandoned,{schemaVersion:1,state:'abandoned',attemptId:firstAttempt});
      assert.deepEqual(await service.abandonCreation(authority,firstAttempt,operation,signal),abandoned);
      assert.deepEqual(await service.setupState(authority,signal),{schemaVersion:1,state:'ready'});
      const expiredLink=new Request(callback+'?'+new URLSearchParams({state:first.searchParams.get('state'),code:'fictional-old-link'}));
      assert.notEqual((await service.initialCreationCallback(expiredLink,authority,signal)).state,'staged');
      const next=new URL((await service.begin(authority,signal)).headers.get('location'));
      const nextAttempt=next.searchParams.get('state').split('.')[0];
      assert.equal(await service.confirmCreation(authority,nextAttempt,reviewedOwner,true,signal),true);
      const {rows:[history]}=await admin.query(`SELECT
        (SELECT count(*)::int FROM crest_private.google_calendar_creation_intents WHERE business_id=$1) AS intents,
        (SELECT count(*)::int FROM crest_private.google_calendar_creation_abandonments WHERE business_id=$1) AS abandonments,
        (SELECT count(*)::int FROM crest_private.audit_events WHERE business_id=$1 AND action='abandon_creation') AS audits`,[restarting.business]);
      assert.deepEqual(history,{intents:2,abandonments:1,audits:1});
      await assert.rejects(admin.query('DELETE FROM crest_private.google_calendar_creation_abandonments'),{code:'55000'});
      const exchangeProtocol=await createGoogleCalendarOAuth({clientId:client,callbackUri:callback,verifierKeyId:verifierKey,calendarKeyMaterial:secret,store:{
        begin:async()=>{throw Error('Only consume the already retained attempt');},
        consume:v=>call(oauth,'consume_google_calendar_oauth_attempt',[...context(restarting,'0'),v.attemptId,v.stateDigest]),
      }});
      assert.equal((await exchangeProtocol.callback(new Request(callback+'?'+new URLSearchParams({state:next.searchParams.get('state'),code:'fictional-new-link'})),browser,signal)).state,'exchange_pending');
      const exchangeArgs=[...auth(restarting),issuer,client,callback,nextAttempt];
      await admin.query('BEGIN');
      try{
        const {rows:[count]}=await admin.query(`SELECT
          (SELECT count(*) FROM crest.google_calendar_request_admissions WHERE admitted_at>clock_timestamp()-interval '1 minute')+
          (SELECT count(*) FROM crest_private.google_calendar_code_exchanges WHERE admitted_at>clock_timestamp()-interval '1 minute')+
          (SELECT count(*) FROM crest_private.google_calendar_refresh_claims WHERE admitted_at>clock_timestamp()-interval '1 minute')+
          (SELECT count(*) FROM crest.google_calendar_revocation_events WHERE phase='admitted' AND recorded_at>clock_timestamp()-interval '1 minute') AS n`);
        assert(Number(count.n)>0&&Number(count.n)<60);
        await admin.query(`INSERT INTO crest_private.google_calendar_refresh_claims(business_id,credential_id,credential_version,worker_principal,admitted_at,deadline)
          SELECT $1,$2,5000+n,'synthetic_credential_worker',s,s+interval '30 seconds' FROM generate_series(1,$3::int) n CROSS JOIN (SELECT clock_timestamp() AS s) stamp`,[owner.business,id,60-Number(count.n)]);
        await admin.query('SET LOCAL ROLE crest_calendar_oauth');
        assert.equal(await call(admin,'budgeted_google_calendar_creation_exchange',exchangeArgs),null);
      }finally{await admin.query('ROLLBACK');}
      const exchange=await call(oauth,'budgeted_google_calendar_creation_exchange',exchangeArgs);
      assert.equal(exchange.admissionVersion,1);assert.equal(exchange.attemptId,nextAttempt);
      assert.equal(await call(oauth,'abandon_google_calendar_creation',[...auth(restarting),nextAttempt,randomUUID(),true]),null);
      assert.deepEqual(await service.setupState(authority,signal),{schemaVersion:1,state:'review'});
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest_private.google_calendar_creation_intents WHERE business_id=$1',[restarting.business])).rows[0].n,2);
    }
    if(registered>=128){
      const identityOwner=await fixture(),pair=await generateKeyPair('RS256');
      const publicKey={...await exportJWK(pair.publicKey),kid:'native-identity-key',alg:'RS256',use:'sig'};
      const googleSubject='123456789012345678901',remoteId='identity-fixture@group.calendar.google.com';
      const [credentialHash,appSessionId,actorId,authIssuer,authSubject,authProviderSessionId,providerDeadline]=identityOwner.auth();
      const authority={businessId:identityOwner.business,recoveryEpoch:identityOwner.epoch,connectionGeneration:'0',credentialHash,appSessionId,actorId,authIssuer,authSubject,authProviderSessionId,providerValidUntil:providerDeadline.getTime()};
      let expectedNonce,creates=0,tokens=0,keyReads=0,calendarReads=0,revokes=0,signingSubject=googleSubject;
      async function providerRequest(url,init){
        if(url==='https://oauth2.googleapis.com/revoke'){revokes++;return new Response(null,{status:200});}
        if(url==='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(remoteId)+'?fields=kind,id,summary,dataOwner'){
          assert.equal(init.method,'GET');calendarReads++;return Response.json({kind:'calendar#calendar',id:remoteId,summary:'Crest Jobs',dataOwner:reviewedOwner});
        }
        if(url==='https://www.googleapis.com/oauth2/v3/certs'){
          assert.equal(init.headers.authorization,undefined);keyReads++;return Response.json({keys:[publicKey]});
        }
        if(url==='https://oauth2.googleapis.com/token'){
          const refresh=new URLSearchParams(init.body).get('grant_type')==='refresh_token';tokens++;
          const base={access_token:refresh?'identity-refreshed-access':'identity-issued-access',token_type:'Bearer',expires_in:3600,scope:'openid '+scope};
          if(refresh)return Response.json(base);
          const jwt=await new SignJWT({nonce:expectedNonce}).setProtectedHeader({alg:'RS256',kid:'native-identity-key'}).setIssuer(issuer).setAudience(client).setSubject(signingSubject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
          return Response.json({...base,refresh_token:'identity-retained-refresh',id_token:jwt});
        }
        assert.equal(url,'https://www.googleapis.com/calendar/v3/calendars?fields=kind,id,summary,description,dataOwner');
        assert.equal(init.method,'POST');assert.equal(init.headers.authorization,'Bearer identity-issued-access');
        const {rows:[admission]}=await admin.query("SELECT count(*)::int AS n FROM crest.google_calendar_request_admissions WHERE business_id=$1 AND kind='create_secondary'",[identityOwner.business]);
        assert.equal(admission.n,1);creates++;
        const body=JSON.parse(init.body);return Response.json({kind:'calendar#calendar',id:remoteId,summary:body.summary,description:body.description,dataOwner:reviewedOwner},{status:201});
      }
      const identityTrace=[];
      const service=await createGoogleCalendarConnection({clientId:client,callbackUri:callback,clientSecret:'fictional-secret',verifierKeyId:verifierKey,credentialKeyId:credentialKey,calendarKeyMaterial:secret,budgetedExchanges:true,withIdentity:true,...(registered>=129?{reviewedConsent:true}:{}),
        committedQuery:async(sql,args)=>{
          const command=sql.match(/crest_commands\.[a-z_]+/)?.[0];
          try{const result=(await oauth.query(sql,args)).rows[0].result;identityTrace.push({command,result:result===null?'null':typeof result==='object'?Object.keys(result).sort().join(','):typeof result});return result;}
          catch(error){identityTrace.push({command,error:typeof error.code==='string'?error.code:'unknown',constraint:/^[a-z_]+$/.test(error.constraint??'')?error.constraint:undefined});throw error;}
        },request:providerRequest});
      const authorization=new URL((await service.begin(authority,signal)).headers.get('location'));
      expectedNonce=authorization.searchParams.get('nonce');assert.match(expectedNonce,/^[A-Za-z0-9_-]{43}$/);assert.equal(authorization.searchParams.get('scope'),scope+' openid');
      const initialAttempt=authorization.searchParams.get('state').split('.')[0];
      assert.equal(await service.confirmCreation(authority,initialAttempt,reviewedOwner,true,signal),true);
      const staged=await service.initialCreationCallback(new Request(callback+'?'+new URLSearchParams({state:authorization.searchParams.get('state'),code:'fictional-identity-code'})),authority,signal);
      assert.equal(staged.state,'staged');assert.equal(creates,1);assert.equal(tokens,1);assert.equal(keyReads,1);
      const {rows:[pinned]}=await admin.query(`SELECT destination_id,provider_issuer,provider_subject,credential_id,source_attempt,client_id FROM crest_private.google_calendar_account_bindings WHERE business_id=$1`,[identityOwner.business]);
      assert.equal(pinned.provider_issuer,issuer);assert.equal(pinned.provider_subject,googleSubject);assert.equal(pinned.credential_id,staged.credentialId);assert.equal(pinned.source_attempt,initialAttempt);assert.equal(pinned.client_id,client);
      await assert.rejects(oauth.query('SELECT provider_subject FROM crest_private.google_calendar_account_bindings'),{code:'42501'});
      await assert.rejects(web.query('SELECT provider_subject FROM crest_private.google_calendar_account_bindings'),{code:'42501'});
      const selected={clientName:false,serviceLabel:false,workAddress:false};
      const preview=await service.prepareConsent(authority,pinned.destination_id,staged.credentialId,selected,signal);assert(preview);
      const confirmed=await service.confirmConsent(authority,{destinationId:pinned.destination_id,credentialId:staged.credentialId,reviewId:preview.reviewId,disclosure:selected,payloadReviewed:true,sharingReviewed:true,notificationsReviewed:true},signal);
      assert.equal(confirmed.state,'active');
      const dispatcher=await worker('synthetic_identity_worker',identityOwner);
      const refresh=createGoogleCalendarRefresh({clientId:client,clientSecret:'fictional-secret',callbackUri:callback,credentialKeyId:credentialKey,store:credentialStore,query:async(sql,args)=>(await dispatcher.query(sql,args)).rows[0].result,request:providerRequest});
      const refreshed=await refresh({businessId:identityOwner.business,destinationId:pinned.destination_id,recoveryEpoch:identityOwner.epoch,generation:'1'},signal);
      assert.equal(refreshed.state,'refreshed');assert.deepEqual(refreshed.grant.identity,{issuer,subject:googleSubject});assert.equal(refreshed.grant.forPrivateCredentialStore().refreshToken,'identity-retained-refresh');
      const {rows:[retained]}=await admin.query('SELECT key_id AS "keyId",envelope,version::text FROM crest_private.google_calendar_credentials WHERE id=$1',[staged.credentialId]);
      assert.equal(retained.version,'2');
      const opened=await credentialStore.open(binding(identityOwner,pinned.destination_id,'1',staged.credentialId,'2'),retained,transport.openRetained);
      assert.deepEqual(opened.identity,{issuer,subject:googleSubject});assert.equal(tokens,2);assert.equal(creates,1);assert.equal(keyReads,1);
      if(registered>=129){
        const target=await service.reconnectTarget(authority,signal);assert.equal(target.generation,'1');assert.equal(target.subject,googleSubject);
        await assert.rejects(call(web,'read_google_calendar_reconnect_target',auth(identityOwner)),{code:'42501'});
        assert.equal(await call(oauth,'read_google_calendar_reconnect_target',auth(foreign)),null);
        await assert.rejects(service.startReconnect(authority,randomUUID(),'1',reviewedOwner,signal));
        async function reconnect(generation){
          const redirect=await service.startReconnect(authority,pinned.destination_id,generation,reviewedOwner,signal),url=new URL(redirect.headers.get('location'));
          expectedNonce=url.searchParams.get('nonce');
          return service.callback(new Request(callback+'?'+new URLSearchParams({state:url.searchParams.get('state'),code:'fictional-reconnect-'+generation})),{...authority,connectionGeneration:generation},signal);
        }
        const renewed=await reconnect('1');assert.equal(renewed.state,'staged',JSON.stringify(identityTrace));assert.equal(renewed.generation,'2');assert.equal(creates,1);assert.equal(calendarReads,1);
        assert.deepEqual(await service.setupState(authority,signal),{schemaVersion:1,state:'staged',destinationId:pinned.destination_id,credentialId:renewed.credentialId,recoveryEpoch:identityOwner.epoch});
        assert.equal(await call(dispatcher,'claim_budgeted_google_calendar_refresh',[identityOwner.business,pinned.destination_id,identityOwner.epoch,'2']),null);
        const sharing=await service.prepareConsent(authority,pinned.destination_id,renewed.credentialId,selected,signal);assert(sharing);
        assert.equal(await service.confirmConsent(authority,{destinationId:pinned.destination_id,credentialId:renewed.credentialId,reviewId:sharing.reviewId,disclosure:selected,payloadReviewed:false,sharingReviewed:true,notificationsReviewed:true},signal),null);
        const saved=await service.confirmConsent(authority,{destinationId:pinned.destination_id,credentialId:renewed.credentialId,reviewId:sharing.reviewId,disclosure:selected,payloadReviewed:true,sharingReviewed:true,notificationsReviewed:true},signal);
        assert.equal(saved.generation,'2');assert.equal((await service.lookupConsent(authority,pinned.destination_id,renewed.credentialId,sharing.reviewId,signal)).generation,'2');
        assert.equal((await service.lookupConsent(authority,pinned.destination_id,staged.credentialId,preview.reviewId,signal)).state,'changed');
        const beforeReads=calendarReads;signingSubject='another-google-account';
        assert.equal((await reconnect('2')).state,'review');assert.equal(calendarReads,beforeReads);assert.equal(creates,1);
        assert.equal(await service.reconnectTarget(authority,signal),null);
        assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest_private.google_calendar_reconnection_stagings WHERE business_id=$1',[identityOwner.business])).rows[0].n,1);
        const fence=await service.beginDisconnect(authority,pinned.destination_id,'2',randomUUID(),signal);assert.equal(await service.reconnectTarget(authority,signal),null);
        assert.equal((await service.disconnectStatus(authority,pinned.destination_id,fence.disconnectId,signal,true)).state,'disconnected');assert.equal(revokes,1);
        assert.equal((await service.reconnectTarget(authority,signal)).generation,'3');
        signingSubject=googleSubject;const restored=await reconnect('3');assert.equal(restored.state,'staged');assert.equal(restored.generation,'4');assert.equal(creates,1);
        const finalReview=await service.prepareConsent(authority,pinned.destination_id,restored.credentialId,selected,signal);assert(finalReview);
        assert.equal((await service.confirmConsent(authority,{destinationId:pinned.destination_id,credentialId:restored.credentialId,reviewId:finalReview.reviewId,disclosure:selected,payloadReviewed:true,sharingReviewed:true,notificationsReviewed:true},signal)).generation,'4');
        assert.deepEqual((await admin.query('SELECT generation::text,state FROM crest.google_calendar_consents WHERE business_id=$1 ORDER BY generation',[identityOwner.business])).rows,[{generation:'1',state:'active'},{generation:'2',state:'active'},{generation:'3',state:'disconnected'},{generation:'4',state:'active'}]);
        assert.equal((await service.setupState(authority,signal)).credentialId,restored.credentialId);
        await assert.rejects(admin.query('DELETE FROM crest_private.google_calendar_reconnection_stagings'),{code:'55000'});
        assert.equal((await admin.query('SELECT provider_subject FROM crest_private.google_calendar_account_bindings WHERE business_id=$1',[identityOwner.business])).rows[0].provider_subject,googleSubject);
      }
      if(registered>=131){
        await admin.query('CREATE ROLE synthetic_current_calendar_export NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
        await admin.query('GRANT crest_export TO synthetic_current_calendar_export');
        const reader=await sandbox.connect(database);await reader.query('SET SESSION AUTHORIZATION synthetic_current_calendar_export');await reader.query('SET ROLE crest_export');
        const query=async(sql,args)=>(await reader.query(sql,args)).rows;
        await assert.rejects(captureGoogleCalendarPortableSource(identityOwner.business,query,2),{code:'25001'});
        await assert.rejects(reader.query('SELECT envelope FROM crest_private.google_calendar_credentials'),{code:'42501'});
        await assert.rejects(reader.query('SELECT provider_subject FROM crest_private.google_calendar_account_bindings'),{code:'42501'});
        await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try{
          const legacy=await captureGoogleCalendarPortableSource(identityOwner.business,query),current=await captureGoogleCalendarPortableSource(identityOwner.business,query,2);
          assert.equal(JSON.parse(legacy.manifest).scope,'crest.google-calendar-portable-source.v1');assert.equal(JSON.parse(current.manifest).scope,'crest.google-calendar-portable-source.v2');
          for(const [name,bytes]of Object.entries(legacy.files))if(name.endsWith('.csv'))assert.deepEqual(current.files[name],bytes);
          const dictionary=JSON.parse(strFromU8(current.files['calendar_dictionary.json'])),escapes=JSON.parse(strFromU8(current.files['calendar_escape_map.json']));assert.equal(dictionary.schemaVersion,2);
          const csv=group=>readSourceExportCsv(strFromU8(current.files[group+'.csv']),escapes[group],{columns:dictionary.columns[group],maxRows:1000});
          assert.equal(csv('account_bindings').length,1);assert.equal(csv('reconnection_stagings').length,2);assert.equal(csv('credential_metadata').length,3);assert.equal(csv('code_exchange_metadata').length,4);
          const workbook=unzipSync(current.files['calendar.xlsx']);assert.equal(Object.keys(workbook).filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length,Object.keys(dictionary.columns).length);
          const readable=Object.entries(current.files).filter(([name])=>name.endsWith('.csv')||name.endsWith('.json')).map(([,value])=>strFromU8(value)).join('\n')+Object.values(workbook).map(value=>strFromU8(value)).join('\n');
          for(const privateValue of [googleSubject,reviewedOwner,'identity-issued-access','identity-retained-refresh',expectedNonce])assert.equal(readable.includes(privateValue),false);
          assert.equal(readable.includes('<f>'),false);assert.equal(readable.includes(foreign.business),false);
          const restarted=await captureGoogleCalendarPortableSource(restartingExportBusiness,query,2),restartedDictionary=JSON.parse(strFromU8(restarted.files['calendar_dictionary.json'])),restartedEscapes=JSON.parse(strFromU8(restarted.files['calendar_escape_map.json']));
          const abandoned=readSourceExportCsv(strFromU8(restarted.files['creation_abandonments.csv']),restartedEscapes.creation_abandonments,{columns:restartedDictionary.columns.creation_abandonments,maxRows:1000});assert.equal(abandoned.length,1);assert.equal(abandoned[0].business_id,restartingExportBusiness);
          await reader.query('COMMIT');
        }catch(error){await reader.query('ROLLBACK');throw error;}
      }
      if(registered>=132){
        const password=randomBytes(32).toString('hex');
        await admin.query("ALTER ROLE synthetic_current_calendar_export LOGIN PASSWORD '"+password+"'");
        await admin.query('GRANT crest_export TO synthetic_current_calendar_export WITH INHERIT FALSE, SET TRUE, ADMIN FALSE');
        const connection=new URL(database);connection.username='synthetic_current_calendar_export';connection.password=password;
        const registry=JSON.parse(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url),'utf8'));
        const migrationIdentity=registry.migrations.slice(0,registered).map(entry=>({version:entry.version,name:entry.file.slice(15,-4)}));
        const config={environment:'test',businessId:identityOwner.business,connectionString:connection.toString(),migrationIdentity};
        const flags=Array(16).fill(true);
        const capture=(await createServiceRefundSourceCollector(config,...flags)(signal)).forFinanceServer();
        assert.equal(capture.profile,'crest.posted-finance-source.v23');assert.equal(capture.completeBackup,false);assert.equal(capture.completePortableExport,false);
        await assert.rejects(createServiceRefundSourceCollector({...config,migrationIdentity:migrationIdentity.slice(0,-1)},...flags)(signal),{message:'BUSINESS_FOUNDATION_COLLECTION_REVIEW_REQUIRED'});
        const restricted=await sandbox.connect(connection.toString());await restricted.query('SET ROLE crest_export');
        assert.equal((await restricted.query('SELECT version,name FROM supabase_migrations.schema_migrations')).rowCount,registered);
        await assert.rejects(restricted.query('SELECT statements FROM supabase_migrations.schema_migrations'),{code:'42501'});
        await assert.rejects(restricted.query("UPDATE supabase_migrations.schema_migrations SET name='changed'"),{code:'42501'});
        if(registered>=133){
          await restricted.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          try{const direct=await captureCurrentBusinessRows(identityOwner.business,async(sql,args)=>(await restricted.query(sql,args)).rows,()=>{}),directIdentity=await captureCurrentIdentitySource(direct,async(sql,args)=>(await restricted.query(sql,args)).rows,()=>{});await captureCurrentSessionSource(directIdentity,direct,async(sql,args)=>(await restricted.query(sql,args)).rows,()=>{});}finally{await restricted.query('ROLLBACK');}
          const collected=await createCurrentBusinessSourceCollector(config)(signal),source=collected.forCurrentBusinessServer(),identitySource=collected.forCurrentBusinessIdentityServer(),sessionSource=collected.forCurrentBusinessSessionServer(),providerSource=collected.forCurrentBusinessProviderServer();
          assert.equal(providerSource!==undefined,registered>=135);if(providerSource){assert.equal(providerSource.sources.length,8);assert.equal(providerSource.businessSnapshotToken,source.snapshotToken);}
          assert.equal(source.sources.length,167);assert(source.recordCount>0);
          const coverage=JSON.parse(await readFile(new URL(registered<138?'../support/registered'+registered+'-export-coverage.json':'../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8'));
          assert.deepEqual(source.sources.map(item=>({table:item.source,required:item.columns})),coverage.tables.filter(item=>item.scope==='business').map(item=>({table:item.table,required:item.required})));
          assert.equal(identitySource.businessSnapshotToken,source.snapshotToken);assert.equal(identitySource.businessId,source.businessId);
          for(const item of identitySource.sources)assert.deepEqual(item.columns,coverage.tables.find(table=>table.table===item.source).required,'identity columns match the registered closed source inventory');
          assert.deepEqual(sessionSource.source.columns,coverage.tables.find(table=>table.table===sessionSource.source.source).required);assert.equal(sessionSource.businessSnapshotToken,source.snapshotToken);assert.equal(sessionSource.identitySnapshotToken,identitySource.identitySnapshotToken);
          const ownerIds=identitySource.sources[0].rows.filter(row=>row.auth_provider_issuer!==null).map(row=>row.id);
          await admin.query("SET TIME ZONE 'UTC'");
          const actualSessions=(await admin.query('SELECT jsonb_object_agg(field.name,to_jsonb(s)->>field.name) AS row FROM crest_private.app_sessions s CROSS JOIN LATERAL unnest($2::text[]) AS field(name) WHERE s.actor_id=ANY($1::uuid[]) GROUP BY s.id ORDER BY s.id',[ownerIds,sessionSource.source.columns])).rows.map(item=>item.row);
          assert.deepEqual(sessionSource.source.rows,actualSessions,'all scoped noncredential session values match the actual database');assert(sessionSource.recordCount>0);assert(!sessionSource.source.columns.includes('credential_hash'));
          let directCount=0;
          for(const group of source.sources){
            const businessColumn=group.source==='crest.businesses'?'id':'business_id';
            const total=(await admin.query('SELECT count(*)::integer AS total FROM '+group.source+' WHERE '+businessColumn+'=$1',[identityOwner.business])).rows[0].total;
            assert.equal(group.rows.length,total,group.source+' retains every business row');directCount+=total;
            for(const row of group.rows)assert.equal(row[businessColumn],identityOwner.business);
          }
          assert.equal(source.recordCount,directCount);
          const bundle=formatCurrentBusinessPortableSource(source,{appReleaseId:'a'.repeat(40),sourceSchemaVersion:registered},identitySource,sessionSource,providerSource),dictionary=JSON.parse(Buffer.from(bundle.files['current_business_dictionary.json']).toString()),escapes=JSON.parse(Buffer.from(bundle.files['current_business_escape_map.json']).toString());
          for(const group of source.sources){const file=group.source.replace('.','_')+'.csv';assert.deepEqual(readCurrentBusinessCsv(Buffer.from(bundle.files[file]).toString(),dictionary[file].columns,escapes[file]),group.rows);}
          const workbook=unzipSync(bundle.files['business_records.xlsx']),workbookCoverage=JSON.parse(Buffer.from(bundle.files['workbook_coverage.json']).toString());
          assert.equal(workbookCoverage.sheets.length,source.sources.length+3);assert.equal(Object.keys(workbook).filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length,source.sources.length+3);
          const neutral=await sandbox.connect(await sandbox.database());
          await neutral.query('SET standard_conforming_strings = off');
          await neutral.query(Buffer.from(bundle.files['business_records_reimport.txt']).toString());
          for(const table of [...source.sources,...identitySource.sources,sessionSource.source,...providerSource?.sources??[]]){
            const target=table.source.replace('.','_'),order=table.primaryKey.map(column=>'"'+column.replaceAll('"','""')+'" COLLATE "C"').join(',');
            assert.deepEqual((await neutral.query('SELECT * FROM crest_portable_source."'+target+'" ORDER BY '+order)).rows,table.rows,'neutral SQL reimport retains every exact source value: '+table.source);
            const metadata=(await neutral.query('SELECT * FROM crest_portable_source._crest_export WHERE source_name=$1',[table.source])).rows[0];
            assert.equal(metadata.row_count,String(table.rows.length));assert.deepEqual(JSON.parse(metadata.types_json),table.types);assert.deepEqual(JSON.parse(metadata.primary_key_json),table.primaryKey);assert.equal(metadata.complete_portable_export,'false');assert.equal(metadata.complete_backup,'false');
          }
          assert.equal((await neutral.query("SELECT count(*)::integer AS total FROM pg_namespace WHERE nspname IN('crest','crest_private')")).rows[0].total,0,'neutral import creates no application schema');
          await assert.rejects(neutral.query(Buffer.from(bundle.files['business_records_reimport.txt']).toString()),{code:'42P06'});await neutral.query('ROLLBACK');
          assert.equal((await neutral.query('SELECT count(*)::integer AS total FROM crest_portable_source._crest_export')).rows[0].total,source.sources.length+identitySource.sources.length+1+(providerSource?.sources.length??0),'existing import is never replaced');
          const exported=Object.entries(bundle.files).filter(([name])=>!name.endsWith('.xlsx')).map(([,bytes])=>Buffer.from(bytes).toString()).join('\n')+Object.values(workbook).map(bytes=>strFromU8(bytes)).join('\n');
          assert.equal(exported.includes('<f>'),false);
          assert.equal(exported.includes(foreign.business),false);
          for(const value of [googleSubject,reviewedOwner,'identity-issued-access','identity-retained-refresh',expectedNonce])assert.equal(exported.includes(value),false,'private Calendar identity/grant omitted');
          await assert.rejects(restricted.query('SELECT * FROM crest_private.google_calendar_credentials'),{code:'42501'});
          await assert.rejects(restricted.query('SELECT crest_commands.business_source_page_v1($1,$2,NULL,NULL,1)',[identityOwner.business,'crest.customers']),{code:'25001'});
          await restricted.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          try{
            let token=null,cursor=null,records=[];
            do{const page=(await restricted.query('SELECT crest_commands.business_source_page_v1($1,$2,$3,$4,1) AS page',[identityOwner.business,'crest_private.google_calendar_code_exchanges',token,cursor])).rows[0].page;token=page.snapshotToken;cursor=page.nextCursor;records.push(...page.rows);}while(cursor!==null);
            assert.equal(records.length,4);assert.equal(new Set(records.map(row=>row.attempt_id)).size,4);
            await assert.rejects(restricted.query('SELECT crest_commands.business_source_page_v1($1,$2,$3,NULL,1)',[identityOwner.business,'crest.customers','0'.repeat(64)]),{code:'22023'});
          }finally{await restricted.query('ROLLBACK');}
          await restricted.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          try{await assert.rejects(restricted.query('SELECT crest_commands.business_source_page_v1($1,$2,NULL,NULL,1)',[identityOwner.business,'crest_private.app_sessions']),{code:'22023'});}finally{await restricted.query('ROLLBACK');}
          await assert.rejects(web.query('SELECT crest_commands.business_source_page_v1($1,$2,NULL,NULL,1)',[identityOwner.business,'crest.customers']),{code:'42501'});
          if(registered>=134){
            const requestName=registered===138?'request_current_source_export_v5_for_execution':registered===137?'request_current_source_export_v4_for_execution':registered===136?'request_current_source_export_v3_for_execution':registered===135?'request_current_source_export_v2_for_execution':'request_current_source_export_for_execution';
            const appReleaseId='a'.repeat(40),jobId=randomUUID(),operationId=randomUUID();
            const command={schemaVersion:1,businessId:identityOwner.business,commandType:'export.request',reference:{operationId,exportJobId:jobId,recoveryEpoch:identityOwner.epoch,appReleaseId,profile:'crest.current-business-source-bundle.v1',sourceSchemaVersion:registered}};
            const args=[...auth(identityOwner),operationId,jobId,appReleaseId];
            const admission=parseSourceExportAdmission(await call(web,requestName,args),command,actorId);
            assert.equal(admission.state,'created');assert.equal(admission.result.receipt.job.profile,command.reference.profile);
            const replay=parseSourceExportAdmission(await call(web,requestName,args),command,actorId);assert.equal(replay.state,'recorded');assert.deepEqual(replay.result,admission.result);
            assert.deepEqual(await call(web,requestName,[...auth(identityOwner),operationId,jobId,'b'.repeat(40)]),{state:'conflict',reason:'operation'});
            assert.deepEqual(await call(web,requestName,[...auth(identityOwner),randomUUID(),randomUUID(),appReleaseId]),{state:'conflict',reason:'active_or_identity'});
            const leaseId=randomUUID(),claimed=await call(web,'claim_source_export',[...auth(identityOwner),randomUUID(),jobId,'1',leaseId]);assert.equal(claimed.receipt.job.state,'Running');
            const current={formatVersion:1,profile:command.reference.profile,businessId:identityOwner.business,actorId,exportJobId:jobId,recoveryEpoch:identityOwner.epoch,leaseId},readyId=randomUUID();
            const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
            const custody=await custodyFixture(async(method,key,bytes)=>{
              const rows=(await admin.query('SELECT ciphertext_sha256,ciphertext_bytes FROM crest_private.export_part_intents WHERE business_id=$1 AND object_key=$2',[identityOwner.business,key])).rows;
              assert.equal(rows.length,1,'committed intent before any storage request');if(method==='PUT'){assert.equal(rows[0].ciphertext_sha256,hash(bytes));assert.equal(rows[0].ciphertext_bytes,bytes.length);}
            });
            try{
              const names={authorize:'authorize_source_export_worker',snapshot:'record_source_export_snapshot',intent:'record_source_export_part_intent',verified:'record_source_export_part_verified',ready:'record_source_export_ready'};
              const jobs=Object.fromEntries(Object.entries(names).map(([stage,name])=>[stage,request=>call(web,name,[...auth(identityOwner),...stage==='ready'?[readyId,claimed.receipt.job.version]:[],JSON.stringify(request)])]));
              const worker=createCurrentBusinessExportWorker({businessId:identityOwner.business,appReleaseId,sourceSchemaVersion:registered},createCurrentBusinessSourceCollector(config),custody.store,jobs),result=(await worker.run(current,signal)).forServer();
              const status=await call(web,'read_source_export',[...identityOwner.auth(),jobId]);assert.equal(status.job.state,'Ready');assert.equal(status.job.source_schema_version,registered);
              assert.equal((await call(web,requestName,args)).state,'recorded');
              const access={downloadPart:async(_credential,request)=>{const raw=await call(web,'read_source_export_download_part',[...identityOwner.auth(),request.exportJobId,request.generationId,request.partId]),value=parseSourceExportDownloadPermit(raw,identityOwner.business,actorId,request);return {forServer:()=>value};},recordDownloadAccess:async(_credential,request,permit)=>{const value=await call(web,'record_source_export_download_access',[...identityOwner.auth(),request.exportJobId,request.generationId,request.partId,JSON.stringify(sourceExportDownloadPermitRecord(permit))]);return {forServer:()=>value};}};
              const delivery=createSourceExportDownloadReader(identityOwner.business,access,custody.store),downloaded=[];let afterOrdinal=0;
              do{
                const request={exportJobId:jobId,generationId:result.generationId,afterOrdinal},page=parseSourceExportDownloadCatalogue(await call(web,'read_source_export_download_page',[...identityOwner.auth(),jobId,result.generationId,afterOrdinal]),identityOwner.business,request);
                assert.equal(page.profile,command.reference.profile);assert.equal(page.sourceSchemaVersion,registered);
                for(const file of page.files)await delivery.deliver('native-sql-authority-port',{exportJobId:jobId,generationId:result.generationId,partId:file.partId},signal,async value=>{downloaded.push({name:file.fileName,bytes:Buffer.from(value.bytes)});});
                afterOrdinal=page.nextOrdinal;
              }while(afterOrdinal!==null);
              assert.equal(downloaded.length,result.parts);
              const root=downloaded.find(file=>file.name==='source_manifest.json'),physical=downloaded.filter(file=>file.name!=='source_manifest.json');
              const restored=await readCurrentSourceLogicalFiles(root.bytes.toString(),physical,{businessId:identityOwner.business,generationId:result.generationId,appReleaseId,sourceSchemaVersion:registered},signal);
              assert(restored.some(file=>file.name==='business_records.xlsx'));assert(restored.some(file=>file.name==='crest_customers.csv'));
              const selectedNames=new Set(JSON.parse(root.bytes.toString()).files.find(file=>file.name==='business_records.xlsx').parts.map(part=>part.name));
              const selected=await readCurrentSourceLogicalSelection(root.bytes.toString(),physical.filter(file=>selectedNames.has(file.name)),{businessId:identityOwner.business,generationId:result.generationId,appReleaseId,sourceSchemaVersion:registered},['business_records.xlsx'],signal);
              assert.equal(selected.length,1);assert(Buffer.from(selected[0].bytes).equals(restored.find(file=>file.name==='business_records.xlsx').bytes));
              const book=unzipSync(restored.find(file=>file.name==='business_records.xlsx').bytes);assert.equal(Object.keys(book).filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length,170);
              const audits=(await admin.query("SELECT count(*)::integer AS total FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='export_accesses' AND action='authorized_handoff'",[identityOwner.business])).rows[0].total;
              assert.equal(audits,result.parts,'each delivered physical file has an audited handoff');
              // Stop preserves the original job, operation and any admitted objects.
              // A fresh request gets a different job, generation and snapshot.
              const queuedId=randomUUID(),queuedOperation=randomUUID();
              assert.equal((await call(web,requestName,[...auth(identityOwner),queuedOperation,queuedId,appReleaseId])).state,'created');
              const queuedStop=parseSourceExportStopCommand({schemaVersion:1,businessId:identityOwner.business,commandType:'export.stop',reference:{operationId:randomUUID(),recoveryEpoch:identityOwner.epoch,exportJobId:queuedId,expectedVersion:'1'}},identityOwner.business);
              const queuedStopArgs=[...auth(identityOwner),queuedStop.reference.operationId,queuedId,'1'];
              const stoppedQueued=parseSourceExportStopOutcome(await call(web,'stop_source_export',queuedStopArgs),queuedStop,actorId);
              assert.equal(stoppedQueued.state,'committed');assert.equal(stoppedQueued.receipt.job.failure_code,'OWNER_STOPPED');
              assert.deepEqual(await call(web,'stop_source_export',queuedStopArgs),stoppedQueued,'same stop is idempotent');
              assert.deepEqual(await call(web,'lookup_source_export_operation',[...identityOwner.auth(),queuedStop.reference.operationId]),stoppedQueued);
              const restartedId=randomUUID(),restartedOperation=randomUUID(),restartedLease=randomUUID();
              assert.equal((await call(web,requestName,[...auth(identityOwner),restartedOperation,restartedId,appReleaseId])).state,'created');
              const restartedClaim=await call(web,'claim_source_export',[...auth(identityOwner),randomUUID(),restartedId,'1',restartedLease]);
              assert.deepEqual(await call(web,'stop_source_export',[...auth(identityOwner),randomUUID(),restartedId,'1']),{state:'conflict',reason:'version'},'late queued stop cannot stop a newer running version');
              const restarted={...current,exportJobId:restartedId,leaseId:restartedLease};let retainedIntent,stoppedRunning;
              const interruptedJobs={...jobs,ready:request=>call(web,names.ready,[...auth(identityOwner),randomUUID(),restartedClaim.receipt.job.version,JSON.stringify(request)]),verified:async request=>{
                retainedIntent=request;
                const stop=parseSourceExportStopCommand({schemaVersion:1,businessId:identityOwner.business,commandType:'export.stop',reference:{operationId:randomUUID(),recoveryEpoch:identityOwner.epoch,exportJobId:restartedId,expectedVersion:restartedClaim.receipt.job.version}},identityOwner.business);
                stoppedRunning=parseSourceExportStopOutcome(await call(web,'stop_source_export',[...auth(identityOwner),stop.reference.operationId,restartedId,stop.reference.expectedVersion]),stop,actorId);
                return call(web,names.verified,[...auth(identityOwner),JSON.stringify(request)]);
              }};
              const interrupted=createCurrentBusinessExportWorker({businessId:identityOwner.business,appReleaseId,sourceSchemaVersion:registered},createCurrentBusinessSourceCollector(config),custody.store,interruptedJobs);
              await assert.rejects(interrupted.run(restarted,signal));assert.equal(stoppedRunning.state,'committed');assert.equal(stoppedRunning.receipt.job.state,'Failed');
              assert.equal((await call(web,'read_source_export',[...identityOwner.auth(),restartedId])).job.failure_code,'OWNER_STOPPED');
              assert.notEqual(retainedIntent.generationId,result.generationId);
              assert.equal((await admin.query('SELECT count(*)::integer AS total FROM crest_private.export_part_intents WHERE business_id=$1 AND export_job_id=$2',[identityOwner.business,restartedId])).rows[0].total,1,'intent retained after late PUT/verification refusal');
              const freshId=randomUUID();assert.equal((await call(web,requestName,[...auth(identityOwner),randomUUID(),freshId,appReleaseId])).state,'created','fresh export remains available after stopping');
              assert.equal((await call(web,'stop_source_export',[...auth(identityOwner),randomUUID(),freshId,'1'])).state,'committed');
              assert.equal((await call(web,'read_source_export',[...identityOwner.auth(),jobId])).job.state,'Ready','original completed export remains intact');
              const absent={...command,reference:{...command.reference,operationId:randomUUID(),exportJobId:randomUUID()}};
              assert.equal((await call(web,'retire_source_export_request',[...auth(identityOwner),absent,'Reviewed unsubmitted current export'])).state,'retired');
              assert.deepEqual(await call(web,requestName,[...auth(identityOwner),absent.reference.operationId,absent.reference.exportJobId,appReleaseId]),{state:'conflict',reason:'operation'});
              assert.equal((await call(web,'lookup_source_export_request_resolution',[...identityOwner.auth(),absent])).state,'retired');
              for(const file of [...restored,...selected,...downloaded])file.bytes.fill(0);
            }finally{await custody.close();}
          }
        }
      }
      await assert.rejects(admin.query('DELETE FROM crest_private.google_calendar_account_bindings'),{code:'55000'});
    }

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
