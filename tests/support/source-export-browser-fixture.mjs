// Disposable Linux-only real Auth/SQL/SigV4/JWE/TLS fixture. It serves compiled
// actual React controls, or an explicit actual Next test application. No hosted
// provider or production activation. The default retains the compiled-control fixture.
import assert from 'node:assert/strict';
import {createConfirmedBookingFixture} from './confirmed-booking-fixture.mjs';
import {field54Candidate} from './field54-candidate.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {browserTestTls} from './browser-test-tls.mjs';
import {readFile,chmod} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import {URI,TOTP} from 'otpauth';
import {migrationSandbox} from './migration-sandbox.mjs';
import {installProviderSchema} from './provider-schema.mjs';
import {startRealAuthService,authResult} from './real-auth-service.mjs';
import {buildSourceExportBrowserFixture} from './source-export-browser-build.mjs';
const signal=()=>new AbortController().signal,sha=value=>createHash('sha256').update(value).digest('hex'),release='a'.repeat(40);
export async function sourceExportBrowserFixture({product=false,workspace=false,catalog=false,quotes=false,quoteReview=false,quoteCommercial=false,appointmentHolds=false,expenses=false,scheduling=false,bookingConflictReview=false,additionalSchedulingAgreement=false,combinedSchedulingAgreements=false,amendments=false,amendmentAcceptance=false,fieldSessions=false,jobCompletion=false}={}){
 assert.equal(typeof jobCompletion,'boolean');assert(!jobCompletion||fieldSessions,'completion requires registered field sessions');
 assert.equal(typeof fieldSessions,'boolean');assert(!fieldSessions||amendmentAcceptance,'field sessions require the genuine held54 product fixture');
 assert.equal(typeof amendmentAcceptance,'boolean');assert(!amendmentAcceptance||amendments&&product,'accepted amendments require the genuine registered53 product fixture');
 assert.equal(typeof amendments,'boolean');assert(!amendments||scheduling,'amendment preparation requires genuine registered52/product/commercial parents');
 assert.equal(typeof combinedSchedulingAgreements,'boolean');assert(!combinedSchedulingAgreements||scheduling,'combined accepted work requires scheduling');
 assert.equal(typeof additionalSchedulingAgreement,'boolean');assert(!additionalSchedulingAgreement||scheduling,'an additional accepted agreement requires scheduling');
 assert.equal(typeof bookingConflictReview,'boolean');assert(!bookingConflictReview||scheduling,'conflict reads require the registered scheduling fixture');
 assert.equal(typeof scheduling,'boolean');assert(!scheduling||product&&workspace&&quotes&&quoteReview&&quoteCommercial,'scheduling requires the genuine accepted-quote product server');
 assert.equal(typeof expenses,'boolean');assert(!expenses||product&&workspace,'expenses require the genuine workspace product server');
 assert.equal(typeof appointmentHolds,'boolean');assert(!appointmentHolds||product&&workspace,'appointment proposals require the actual workspace product server');
 assert.equal(typeof product,'boolean');assert.equal(typeof catalog,'boolean');assert(!catalog||product,'catalog journey uses the actual product server');
 assert.equal(typeof workspace,'boolean');assert(!workspace||product,'workspace journey uses the actual product server');
 assert.equal(typeof quotes,'boolean');assert(!quotes||product,'quote journey uses the actual product server');
 assert.equal(typeof quoteReview,'boolean');assert(!quoteReview||quotes&&product,'quote review uses the registered actual quote product server');
 assert.equal(typeof quoteCommercial,'boolean');assert(!quoteCommercial||product&&workspace&&quotes&&quoteReview,'quote commercial journeys require the actual workspace, quotes and review product server');
 assert(["linux","win32"].includes(process.platform),"supported disposable TLS/Auth browser fixture required");process.env.NODE_ENV='production';
 let sandbox,client,service,login,owned=false,server,h,app;
 async function close(){try{if(app){await app.close();app=undefined;server=undefined;}else if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=undefined;}}finally{try{await h?.close();h=undefined;}finally{try{await service?.close();service=undefined;}finally{try{if(owned){await sandbox.admin.query('DROP ROLE '+login);owned=false;}}finally{await sandbox?.close();sandbox=undefined;}}}}}
 try{
  sandbox=await migrationSandbox();const target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);const previous=await sandbox.apply(target,await sandbox.prefix(42)),registered=await sandbox.apply(target,await sandbox.prefix(43));assert.equal(registered.history.length,43);assert.deepEqual(registered.history.slice(0,42),previous.history);
  if(catalog){const adopted=await sandbox.apply(target,await sandbox.prefix(44));assert.equal(adopted.history.length,44);assert.deepEqual(adopted.history.slice(0,43),registered.history);}
  if(quotes){const adopted=await sandbox.apply(target,await sandbox.prefix(45));assert.equal(adopted.history.length,45);assert.deepEqual(adopted.history.slice(0,43),registered.history);}
  if(quoteReview){const adopted=await sandbox.apply(target,await sandbox.prefix(46));assert.equal(adopted.history.length,46);assert.deepEqual(adopted.history.slice(0,43),registered.history);}
  if(appointmentHolds){const adopted=await sandbox.apply(target,await sandbox.prefix(47));assert.equal(adopted.history.length,47);assert.deepEqual(adopted.history.slice(0,43),registered.history);}
  if(quoteCommercial){const adopted=await sandbox.apply(target,await sandbox.prefix(48));assert.equal(adopted.history.length,48);assert.deepEqual(adopted.history.slice(0,43),registered.history);}
  if(expenses){const adopted=await sandbox.apply(target,await sandbox.prefix(49));assert.equal(adopted.history.length,49);assert.deepEqual(adopted.history.slice(0,43),registered.history);}
  if(scheduling){const adopted=await sandbox.apply(target,await sandbox.prefix(51));assert.equal(adopted.history.length,51);assert.deepEqual(adopted.history.slice(0,43),registered.history);}
  if(amendments){const adopted=await sandbox.apply(target,await sandbox.prefix(52));assert.equal(adopted.history.length,52);assert.deepEqual(adopted.history.slice(0,43),registered.history);}
  if(amendmentAcceptance){const adopted=await sandbox.apply(target,await sandbox.prefix(53));assert.equal(adopted.history.length,53);assert.deepEqual(adopted.history.slice(0,43),registered.history);}
  if(jobCompletion)assert.equal((await sandbox.apply(target)).history.length,55);
  else if(fieldSessions){const candidate=await field54Candidate(sandbox),adopted=await sandbox.apply(target,candidate.directory);assert.equal(adopted.registrySha256,candidate.registrySha256);assert.equal(adopted.history.length,54);}
  const compiled=await buildSourceExportBrowserFixture(sandbox.workspace),runtime=await import(pathToFileURL(compiled.server).href);
  login='crest_export_browser_'+randomBytes(8).toString('hex');const secret=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+secret+"'");owned=true;await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=secret;const config={connectionString:url.toString(),environment:'test'};
  service=await startRealAuthService(target,{diagnostic:amendmentAcceptance});const email='synthetic-browser-export-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url'),user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'export_browser_user').user;assert(user?.id);
  const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'export_browser_enrollment');const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic export browser MFA'}),'export_browser_factor'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'export_browser_mfa');
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;let actor,business,epoch;
  await client.query('BEGIN');try{
   actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic export browser owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
   business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic export browser business',$2,$1,$1,'manual') RETURNING id",[actor,fieldSessions?'America/Indiana/Indianapolis':'UTC'])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
   epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  const auth=(await runtime.createAuthenticationRuntime({database:config,provider:{issuer:service.issuer,publicKey:service.publicKey,environment:'test'},owner:{subject:user.id,factorId:factor.id},loginKey:randomBytes(32),ingress:{kind:'direct'},activeKeyId:'synthetic-browser',keys:[{id:'synthetic-browser',key:randomBytes(32)}]})).forServer(),lifecycle=runtime.createSessionLifecycle(config,auth.provider,auth.tokens),database=runtime.sessionDatabase(config);
  const issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal()),credential=issued.cookieValueForResponse(),verified=await lifecycle.verify(credential,signal(),'background',true),hash=runtime.sessionCredentialHash(credential),jobId=randomUUID(),leaseId=randomUUID(),operation=randomUUID();let job;
  try{const args=[hash,verified.sessionId,actor,service.issuer,user.id,verified.provider.sessionId,new Date(verified.provider.expiresAt),business,epoch];await database.commandTransaction(q=>q('SELECT crest_commands.request_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',[...args,randomUUID(),jobId,release]),signal());job=(await database.commandTransaction(q=>q('SELECT crest_commands.claim_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',[...args,randomUUID(),jobId,'1',leaseId]),signal())).receipt.job;}finally{hash.fill(0);}
  let bookingRequest,bookingFamilyId,additionalBookingRequest,additionalBookingFamilyId,fieldVehicleId;
  if(scheduling){
   const web=await sandbox.connect(url.toString()),seedHash=runtime.sessionCredentialHash(credential);
   try{await web.query('SET ROLE crest_web');const principal=await lifecycle.verify(credential,signal(),'background',true),parent=await createConfirmedBookingFixture({client,web,bootstrap})({hash:seedHash,session:principal.sessionId,actor,issuer:service.issuer,subject:user.id,provider:principal.provider.sessionId,deadline:new Date(principal.provider.expiresAt),business,epoch});bookingRequest=confirmedBookingRequest(parent);bookingFamilyId=parent.familyId;if(fieldSessions){fieldVehicleId=randomUUID();const payload={label:'Synthetic field equipment rig',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'business_rig',notes:null,archived:false,archiveReason:null};assert.equal((await web.query('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',[...parent.auth(),epoch,randomUUID(),fieldVehicleId,payload])).rows[0].result.state,'committed');}if(additionalSchedulingAgreement||combinedSchedulingAgreements){const other=await createConfirmedBookingFixture({client,web,bootstrap})({hash:seedHash,session:principal.sessionId,actor,issuer:service.issuer,subject:user.id,provider:principal.provider.sessionId,deadline:new Date(principal.provider.expiresAt),business,epoch},combinedSchedulingAgreements?{customerId:parent.customer}:{});additionalBookingRequest=confirmedBookingRequest(other);additionalBookingFamilyId=other.familyId;}}
   finally{seedHash.fill(0);await web.end();}
  }
  const claim={formatVersion:1,profile:'crest.business-source-journal-bundle.v1',businessId:business,actorId:actor,exportJobId:jobId,recoveryEpoch:epoch,leaseId},observedAt=(await client.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\"') AS value")).rows[0].value,bytes=[product?Buffer.alloc(20000,97):Buffer.from('example'),Buffer.from('{"x":123}')];
  const plan={formatVersion:1,claim,generationId:randomUUID(),observedAt,appReleaseId:release,sourceSchemaVersion:43,manifestSha256:sha(bytes[1]),parts:[{partId:randomUUID(),fileName:'example.csv',contentType:'text/csv; charset=utf-8',bytes:bytes[0].length,sha256:sha(bytes[0])},{partId:randomUUID(),fileName:'source_manifest.json',contentType:'application/json',bytes:9,sha256:sha(bytes[1])}],totalBytes:bytes.reduce((n,value)=>n+value.length,0),referenceClosureComplete:false,completePortableExport:false,completeBackup:false},planSha256=sha(JSON.stringify(plan)),journal=runtime.createSourceExportDatabaseJournal(config,auth.provider,auth.tokens,job,operation),parts=[];
  const stage=async(name,raw)=>{assert.deepEqual(await journal[name](credential,raw,signal()),{formatVersion:1,stage:name,requestSha256:sha(raw)});};h=await runtime.custodyFixture(async()=>{});
  await stage('snapshot',JSON.stringify({plan,planSha256}));for(const [i,p]of plan.parts.entries()){
   const binding={businessId:business,actorId:actor,exportJobId:jobId,generationId:plan.generationId,recoveryEpoch:epoch,partId:p.partId,fileName:p.fileName,contentType:p.contentType},prepared=await h.store.prepare(bytes[i],binding,signal()),payload={claim,generationId:plan.generationId,planSha256,partId:p.partId,intent:prepared.intentForServer()},raw=JSON.stringify(payload);await stage('intent',raw);const intent=await h.store.writeCandidate(prepared,signal());await h.store.verifyCandidate(intent,binding,signal());await stage('verified',raw);parts.push(payload);
  }
  await stage('ready',JSON.stringify({plan,planSha256,parts}));const setupGets=h.requests.filter(r=>r.method==='GET').length;assert.equal(setupGets,4);assert.equal(h.requests.filter(r=>r.method==='PUT').length,2);
  await chmod(sandbox.workspace,0o700);const tls=await browserTestTls();server=runtime.createBoundedNodeServer(tls);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='https://127.0.0.1:'+server.address().port,requests=[];
  if(product){
   const port=server.address().port;await new Promise(resolve=>server.close(resolve));server=undefined;
   app=await runtime.createCrestApplication({origin,environment:'test',tls,authentication:auth,business:{businessId:business},customers:true,...workspace?{vehicles:true,associations:true,leads:true,leadConversions:true,operationResolution:true}:{},...catalog?{syntheticCatalog:true,operationResolution:true}:{sourceExports:{appReleaseId:release,store:h.store}},...quotes?{syntheticQuotes:true,operationResolution:true}:{},...quoteReview?{syntheticQuoteReview:true}:{},...quoteCommercial?{syntheticQuoteCommercial:true,operationResolution:true}:{},...appointmentHolds?{syntheticAppointmentHolds:true,operationResolution:true}:{},...expenses?{syntheticExpenses:true,operationResolution:true}:{},...scheduling?{syntheticScheduling:true}:{},...amendments?{syntheticQuoteAmendments:true}:{},...amendmentAcceptance?{syntheticQuoteAmendmentAcceptance:true}:{},...fieldSessions?{syntheticFieldSessions:true}:{},...jobCompletion?{syntheticJobCompletion:true}:{}});server=app.server;
   server.prependListener('request',incoming=>requests.push({path:new URL(incoming.url,origin).pathname,method:incoming.method}));
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});

  }else{
  const settings={...auth.configuration,origin,environment:'test'},authentication=runtime.createAuthenticationHttp(settings,auth.provider,auth.tokens),owner=runtime.createSourceExportHttp({...settings,businessId:business,appReleaseId:release},auth.provider,auth.tokens,true),download=runtime.createSourceExportDownloadHttp({...settings,businessId:business},auth.provider,auth.tokens,h.store,true);
  const css=await readFile(new URL('../../src/app/globals.css',import.meta.url),'utf8'),headers={'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
  server.on('request',(incoming,outgoing)=>{void(async()=>{
   const controller=new AbortController(),abort=()=>{if(!outgoing.writableFinished)controller.abort();};incoming.once('aborted',abort);outgoing.once('close',abort);
   try{
    const path=new URL(incoming.url,origin).pathname;requests.push({path,method:incoming.method});
    if(incoming.method==='GET'){
     const body=path==='/fixture-browser.js'?compiled.browser:path==='/fixture.css'?css:path==='/'?'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic export browser fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main><h1>Synthetic export browser fixture</h1><div id="fixture"></div></main><script src="/fixture-browser.js" defer></script></body></html>':path==='/away'?'<!doctype html><html lang="en"><title>Synthetic other page</title><h1>Synthetic other page</h1></html>':null;
     outgoing.writeHead(body===null?404:200,{...headers,'content-type':path==='/fixture-browser.js'?'text/javascript; charset=utf-8':path==='/fixture.css'?'text/css; charset=utf-8':'text/html; charset=utf-8'});outgoing.end(body??'');return;
    }
    const request=new Request(origin+incoming.url,{method:incoming.method,headers:incoming.headers,body:Readable.toWeb(incoming),duplex:'half',signal:controller.signal}),peer=runtime.transportFromIncomingMessage(incoming),isAuth=path.startsWith('/api/auth/'),response=await (isAuth?authentication:['/api/business/exports/downloads','/api/business/exports/file'].includes(path)?download:owner)(request,peer);
    if(runtime.isSourceExportDownloadResponse(response))await runtime.writeSourceExportDownloadResponse(outgoing,response,controller.signal);else await (isAuth?runtime.writeAuthenticationResponse:runtime.writeOriginalOperationResponse)(outgoing,response,controller.signal);
   }catch{outgoing.destroy();}finally{incoming.off('aborted',abort);outgoing.off('close',abort);}
  })();});
  }
  async function facts(){const out={};for(const table of ['export_jobs','export_job_snapshots','export_part_intents','export_part_verifications','export_job_completions','operations','audit_events'])out[table]=(await client.query('SELECT to_jsonb(v) AS value FROM crest_private.'+table+' v WHERE business_id=$1 ORDER BY to_jsonb(v)::text',[business])).rows;return out;}
  return{origin,product,fieldVehicleId,bookingRequest,bookingFamilyId,additionalBookingRequest,additionalBookingFamilyId,workspace:sandbox.workspace,business,actor,jobId,plan,bytes,client,requests,storage:h,setupGets,facts,authDiagnostics:()=>service.diagnostics(),credentials:()=>({email,password,code:totp.generate(),trusted:false}),close};
 }catch(error){await close();throw error;}
}
