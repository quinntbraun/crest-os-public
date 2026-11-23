// Genuine local Auth/MFA, current PostgreSQL, encrypted export parts, private
// original SDK stores and the actual Next/Node application. Synthetic data only.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {TOTP,URI} from 'otpauth';
import sharp from 'sharp';
import {migrationSandbox} from './migration-sandbox.mjs';
import {installProviderSchema} from './provider-schema.mjs';
import {startRealAuthService,authResult} from './real-auth-service.mjs';
import {buildSourceExportBrowserFixture} from './source-export-browser-build.mjs';
import {browserTestTls} from './browser-test-tls.mjs';
import {createConfirmedBookingFixture} from './confirmed-booking-fixture.mjs';
import {prepareCurrentOriginalSources} from './current-original-sources.mjs';

const signal=()=>new AbortController().signal;
export async function currentOriginalProductFixture(){
 let sandbox,admin,service,app,server,parts,originals,hash;const logins=[];
 async function close(){try{await app?.close();if(!app&&server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}finally{try{await originals?.close();}finally{try{await parts?.close();}finally{try{await service?.close();}finally{try{hash?.fill(0);if(sandbox)for(const login of logins)await sandbox.admin.query('DROP ROLE '+login);}finally{await sandbox?.close();}}}}}}
 try{
  sandbox=await migrationSandbox();const target=await sandbox.database();admin=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(admin,target);assert.equal((await sandbox.apply(target,await sandbox.prefix(138))).history.length,138);
  const compiled=await buildSourceExportBrowserFixture(join(sandbox.workspace,'current-original-runtime')),runtime=await import(pathToFileURL(compiled.server).href);
  async function loginFor(role){const login='crest_original_product_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");logins.push(login);await sandbox.admin.query('GRANT '+role+' TO '+login+' WITH INHERIT FALSE, SET TRUE');const url=new URL(target);url.username=login;url.password=password;return url.toString();}
  const config={connectionString:await loginFor('crest_web'),environment:'test'},exportUrl=await loginFor('crest_export'),financeUrl=await loginFor('crest_finance_preview');
  service=await startRealAuthService(target);const email='synthetic-original-product-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url'),user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'original_product_user').user;assert(user?.id);
  const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'original_product_password');const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic originals MFA'}),'original_product_factor'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'original_product_mfa');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;let actor,business,epoch;await admin.query('BEGIN');try{
   actor=(await admin.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic original product owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
   business=(await admin.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic original product business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await admin.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
   epoch=(await admin.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await admin.query('COMMIT');
  }catch(error){await admin.query('ROLLBACK');throw error;}
  const auth=(await runtime.createAuthenticationRuntime({database:config,provider:{issuer:service.issuer,publicKey:service.publicKey,environment:'test'},owner:{subject:user.id,factorId:factor.id},loginKey:randomBytes(32),ingress:{kind:'direct'},activeKeyId:'synthetic-original-product',keys:[{id:'synthetic-original-product',key:randomBytes(32)}]})).forServer();
  const lifecycle=runtime.createSessionLifecycle(config,auth.provider,auth.tokens),issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal()),credential=issued.cookieValueForResponse(),verified=await lifecycle.verify(credential,signal(),'background',true);hash=runtime.sessionCredentialHash(credential);
  const principal={actor,business,epoch,subject:user.id,issuer:service.issuer,provider:verified.provider.sessionId,session:verified.sessionId,hash,deadline:new Date(verified.provider.expiresAt)},web=await sandbox.connect(target);await web.query('SET ROLE crest_web');
  const owner=await createConfirmedBookingFixture({client:admin,web,bootstrap})(principal),bytes=await sharp({create:{width:1,height:1,channels:3,background:'#304b68'}}).png().toBuffer(),preview=await sharp(bytes).jpeg().toBuffer();
  const source=await prepareCurrentOriginalSources({sandbox,database:target,admin,web,owner,bytes,preview});originals=await runtime.custodyPhotoObjects({bucket:'crest-synthetic-original-product'});
  for(const key of[source.reservation.originalKey,source.supplierReservation.originalKey,`originals/${business}/${source.attempt.dispatch_id}`])originals.objects.set(key,{bytes:Buffer.from(bytes),type:'image/png'});
  parts=await runtime.custodyFixture(async()=>{});const registry=JSON.parse(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url),'utf8')),release=JSON.parse(await readFile(new URL('../../.local/server/build-identity.json',import.meta.url),'utf8')).appReleaseId,jobId=randomUUID(),leaseId=randomUUID();
  const call=async(name,args)=>(await web.query('SELECT crest_commands.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS result',args)).rows[0].result;
  await call('request_current_source_export_v5_for_execution',[...owner.auth(),epoch,randomUUID(),jobId,release]);const claimed=await call('claim_source_export',[...owner.auth(),epoch,randomUUID(),jobId,'1',leaseId]);
  const journal=runtime.createSourceExportDatabaseJournal(config,auth.provider,auth.tokens,claimed.receipt.job,randomUUID()),jobs=runtime.bindCurrentSourceExportJournalWorker(journal,async()=>credential),collector=runtime.createCurrentBusinessSourceCollector({environment:'test',businessId:business,connectionString:exportUrl,migrationIdentity:registry.migrations.map(entry=>({version:entry.version,name:entry.file.slice(15,-4)}))}),worker=runtime.createCurrentBusinessExportWorker({businessId:business,appReleaseId:release},collector,parts.store,jobs);
  const result=(await worker.run({formatVersion:1,profile:'crest.current-business-source-bundle.v1',businessId:business,actorId:actor,exportJobId:jobId,recoveryEpoch:epoch,leaseId},signal())).forServer();
  const tls=await browserTestTls();server=runtime.createBoundedNodeServer(tls);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port,origin='https://127.0.0.1:'+port;await new Promise(resolve=>server.close(resolve));server=undefined;
  const unusedDispatch=async()=>{throw Error('UPLOAD_NOT_EXERCISED_BY_ORIGINAL_DOWNLOAD_FIXTURE');},storage={objects:originals.receipts,dispatch:unusedDispatch,stagingOrigin:originals.origin};
  app=await runtime.createCrestApplication({origin,environment:'test',tls,authentication:auth,business:{businessId:business},customers:true,vehicles:true,associations:true,operationResolution:true,syntheticCatalog:true,syntheticQuotes:true,syntheticQuoteReview:true,syntheticQuoteCommercial:true,syntheticQuoteAmendments:true,syntheticQuoteAmendmentAcceptance:true,syntheticScheduling:true,syntheticFieldSessions:true,syntheticDropoffCustody:true,syntheticExpenses:true,syntheticExpenseReceipts:storage,syntheticSupplierOriginals:storage,syntheticDropoffPhotos:{...storage,objects:originals.store},syntheticFinanceAccounts:{connectionString:financeUrl,moneyChannels:true,supplierBillDrafts:true,supplierPayableReview:true},syntheticPostedFinanceExport:{connectionString:exportUrl,appReleaseId:release,sourceSchemaVersion:138},sourceExports:{appReleaseId:release,store:parts.store}});server=app.server;
  const catalogueResponses=[];server.prependListener('request',(incoming,outgoing)=>{const path=new URL(incoming.url,origin).pathname;if(path==='/api/business/exports/downloads'||path==='/api/business/exports/downloads-batch')outgoing.once('finish',()=>catalogueResponses.push({batch:path.endsWith('-batch'),status:outgoing.statusCode}));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const references=[['expense_receipt',source.receiptId],['supplier_document',source.supplierId],['condition_photo',source.photoId]].map(([kind,attachmentId])=>({exportJobId:jobId,generationId:result.generationId,kind,attachmentId}));
  const accesses=async()=>(await admin.query("SELECT delta->'after' AS scope FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='export_accesses' AND action='authorized_handoff' AND delta->'after'->>'profile'='crest.source-export-original-scope.v1' ORDER BY id",[business])).rows.map(row=>row.scope);
  return{origin,business,actor,jobId,bytes,source,references,originals,accesses,workspace:sandbox.workspace,catalogueDiagnostics:()=>({partCount:result.parts,catalogueResponses:[...catalogueResponses]}),credentials:()=>({email,password,code:totp.generate()}),async revokeBrowserSession(cookie){const tokenHash=runtime.sessionCredentialHash(cookie);try{const id=(await admin.query('SELECT provider_session_id FROM crest_private.app_sessions WHERE token_hash=$1',[tokenHash])).rows[0]?.provider_session_id;assert(id);await admin.query('DELETE FROM auth.sessions WHERE id=$1',[id]);}finally{tokenHash.fill(0);}},close};
 }catch(error){await close();throw error;}
}
