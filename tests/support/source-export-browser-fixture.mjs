// Disposable Linux-only real Auth/SQL/SigV4/JWE/TLS fixture. It serves compiled
// actual React controls, or an explicit actual Next test application. No hosted
// provider or production activation. The default retains the compiled-control fixture.
import assert from 'node:assert/strict';
import {createConfirmedBookingFixture} from './confirmed-booking-fixture.mjs';
import {field54Candidate} from './field54-candidate.mjs';
import {financeHeldTip83Candidate} from './finance-held-tip83-candidate.mjs';
import {financeInvoiceCredit84Candidate} from './finance-invoice-credit84-candidate.mjs';
import {financePairedInvoiceCredit85Candidate} from './finance-paired-invoice-credit85-candidate.mjs';
import {prepareExcessReturnCandidate} from './finance-excess-return-candidate.mjs';
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
export async function sourceExportBrowserFixture({product=false,workspace=false,catalog=false,quotes=false,quoteReview=false,quoteCommercial=false,appointmentHolds=false,expenses=false,scheduling=false,bookingConflictReview=false,additionalSchedulingAgreement=false,combinedSchedulingAgreements=false,amendments=false,amendmentAcceptance=false,fieldSessions=false,jobCompletion=false,jobMileage=false,supportTrips=false,unfulfilledCancellation=false,workTime=false,workBoundary=false,workStart=false,workEnd=false,mobileDeparture=false,reviewOutcome=false,reviewHistory=false,maintenanceFollowUp=false,dropoffCustody=false,dropoffPolicyRevision=false,pickupTrips=false,pickupCollection=false,pickupPolicy=false,pickupPhotos=false,pickupReturnWorkflow=false,financeAccounts=false,financeMappings=false,financeTaxProfiles=false,financeCategoryMappings=false,financeMoneyChannels=false,invoicePreparation=false,invoiceDrafts=false,invoiceIssueTaxReview=false,invoiceIssue=false,directReceipts=false,sameDayExpenses=false,trialBalance=false,paymentCorrections=false,fundApplications=false,heldTips=false,invoiceCredits=false,paidInvoiceCredits=false,serviceRefunds=false,googleCalendar=false,googleCalendarAutomatic=false,postedFinanceExport=false,photoFixture}={}){
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
 assert.equal(typeof financeAccounts,'boolean');assert(!financeAccounts||product&&workspace);
 assert.equal(typeof financeMappings,'boolean');assert(!financeMappings||financeAccounts);
 assert.equal(typeof financeTaxProfiles,'boolean');assert(!financeTaxProfiles||financeAccounts&&catalog);
 assert.equal(typeof financeCategoryMappings,'boolean');assert(!financeCategoryMappings||financeAccounts&&financeMappings);
 assert.equal(typeof financeMoneyChannels,'boolean');assert(!financeMoneyChannels||financeAccounts);
 assert.equal(typeof invoicePreparation,'boolean');assert(!invoicePreparation||financeAccounts&&jobCompletion);
 assert.equal(typeof invoiceIssueTaxReview,'boolean');assert(!invoiceIssueTaxReview||invoiceDrafts&&financeTaxProfiles);
 assert.equal(typeof invoiceIssue,'boolean');assert(!invoiceIssue||invoiceIssueTaxReview&&financeMappings);
 assert(typeof directReceipts==='boolean'&&(!directReceipts||invoiceIssue&&financeMoneyChannels));
 assert(typeof sameDayExpenses==='boolean'&&(!sameDayExpenses||directReceipts&&expenses&&financeCategoryMappings));
 assert(typeof trialBalance==='boolean'&&(!trialBalance||sameDayExpenses));
 assert(typeof paymentCorrections==='boolean'&&(!paymentCorrections||trialBalance));
 assert(typeof fundApplications==='boolean'&&(!fundApplications||paymentCorrections));
 assert(typeof heldTips==='boolean'&&(!heldTips||fundApplications&&financeTaxProfiles));
 assert(typeof invoiceCredits==='boolean'&&(!invoiceCredits||heldTips&&invoiceIssue));
 assert(typeof paidInvoiceCredits==='boolean'&&(!paidInvoiceCredits||invoiceCredits));
 assert(typeof serviceRefunds==='boolean'&&(!serviceRefunds||paidInvoiceCredits&&directReceipts));
 const receivableAging=serviceRefunds&&process.env.CREST_TEST_RECEIVABLE_AGING==='1';
 const customerFundsReport=serviceRefunds&&process.env.CREST_TEST_CUSTOMER_FUNDS_REPORT==='1';
 const excessReceipts=process.env.CREST_TEST_EXCESS_RECEIPTS==='1';
 const applyReceiptFunds=excessReceipts&&process.env.CREST_TEST_RECEIPT_FUNDS_APPLICATION==='1';
 const excessReturnExport=process.env.CREST_TEST_EXCESS_RETURN_EXPORT==='1';
 const tipReturnExport=process.env.CREST_TEST_TIP_RETURN_EXPORT==='1';
 const collectionFailureExport=process.env.CREST_TEST_COLLECTION_FAILURE_EXPORT==='1';
 const refundTransferExport=process.env.CREST_TEST_REFUND_TRANSFER_EXPORT==='1';
 const directReceiptTipExport=process.env.CREST_TEST_DIRECT_RECEIPT_TIP_EXPORT==='1';
 const refundTransferFeeExport=process.env.CREST_TEST_REFUND_TRANSFER_FEE_EXPORT==='1';
 const collectionFailureRecreditExport=process.env.CREST_TEST_COLLECTION_FAILURE_RECREDIT_EXPORT==='1';
 assert(!excessReceipts||product&&directReceipts&&customerFundsReport&&postedFinanceExport);
 assert(!excessReturnExport||excessReceipts&&postedFinanceExport);
 assert(!tipReturnExport||excessReturnExport&&heldTips);
 assert(!collectionFailureExport||tipReturnExport&&trialBalance);
 assert(!refundTransferExport||collectionFailureExport&&serviceRefunds);
 assert(!directReceiptTipExport||refundTransferExport&&financeTaxProfiles);
 assert(!refundTransferFeeExport||directReceiptTipExport);
 assert(!collectionFailureRecreditExport||refundTransferFeeExport&&fundApplications);
 assert.equal(typeof invoiceDrafts,'boolean');assert(!invoiceDrafts||invoicePreparation);
 assert.equal(typeof product,'boolean');assert.equal(typeof catalog,'boolean');assert(!catalog||product,'catalog journey uses the actual product server');
 assert.equal(typeof workspace,'boolean');assert(!workspace||product,'workspace journey uses the actual product server');
 assert.equal(typeof quotes,'boolean');assert(!quotes||product,'quote journey uses the actual product server');
 assert.equal(typeof quoteReview,'boolean');assert(!quoteReview||quotes&&product,'quote review uses the registered actual quote product server');
 assert.equal(typeof quoteCommercial,'boolean');assert(!quoteCommercial||product&&workspace&&quotes&&quoteReview,'quote commercial journeys require the actual workspace, quotes and review product server');
 assert(["linux","win32"].includes(process.platform),"supported disposable TLS/Auth browser fixture required");process.env.NODE_ENV='production';
 assert(!photoFixture||dropoffCustody&&Buffer.isBuffer(photoFixture));
 let sandbox,client,service,login,owned=false,server,h,app,photoStorage,photoLogin,financeLogin,calendarLogin,calendarWorkerLogin,postedFinanceLogin;
 async function close(){try{if(app){await app.close();app=undefined;server=undefined;}else if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=undefined;}}finally{try{await h?.close();h=undefined;}finally{try{await service?.close();service=undefined;}finally{try{if(photoStorage)await photoStorage.close();if(photoLogin)await sandbox.admin.query('DROP ROLE '+photoLogin);if(calendarLogin)await sandbox.admin.query('DROP ROLE '+calendarLogin);if(calendarWorkerLogin)await sandbox.admin.query('DROP ROLE '+calendarWorkerLogin);if(financeLogin)await sandbox.admin.query('DROP ROLE '+financeLogin);if(postedFinanceLogin)await sandbox.admin.query('DROP ROLE '+postedFinanceLogin);if(owned){await sandbox.admin.query('DROP ROLE '+login);owned=false;}}finally{await sandbox?.close();sandbox=undefined;}}}}}
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
  assert.equal(typeof jobMileage,'boolean');assert(!jobMileage||fieldSessions);
  assert.equal(typeof supportTrips,'boolean');assert(!supportTrips||fieldSessions);
  assert.equal(typeof unfulfilledCancellation,'boolean');assert(!unfulfilledCancellation||fieldSessions);
  assert.equal(typeof workTime,'boolean');assert(!workTime||fieldSessions);
  assert.equal(typeof workBoundary,'boolean');assert(!workBoundary||workTime);
  assert.equal(typeof workStart,'boolean');assert(!workStart||workBoundary);
  assert.equal(typeof workEnd,'boolean');assert(!workEnd||workStart&&jobCompletion);
  assert.equal(typeof mobileDeparture,'boolean');assert(!mobileDeparture||workEnd&&jobMileage);
  assert.equal(typeof reviewOutcome,'boolean');assert(!reviewOutcome||jobCompletion);
  assert.equal(typeof reviewHistory,'boolean');assert(!reviewHistory||reviewOutcome);
  assert.equal(typeof maintenanceFollowUp,'boolean');assert(!maintenanceFollowUp||reviewHistory);
  assert.equal(typeof dropoffCustody,'boolean');assert(!dropoffCustody||fieldSessions);
  assert.equal(typeof dropoffPolicyRevision,'boolean');assert(!dropoffPolicyRevision||dropoffCustody);
  assert.equal(typeof pickupPhotos,'boolean');assert(!pickupPhotos||pickupPolicy&&Buffer.isBuffer(photoFixture));
  assert.equal(typeof pickupPolicy,'boolean');assert(!pickupPolicy||pickupCollection);
  assert.equal(typeof pickupCollection,'boolean');assert(!pickupCollection||pickupTrips);
  assert.equal(typeof pickupTrips,'boolean');assert(!pickupTrips||dropoffPolicyRevision);

  assert.equal(typeof pickupReturnWorkflow,'boolean');assert(!pickupReturnWorkflow||pickupPhotos&&jobCompletion&&unfulfilledCancellation);
  if(invoiceIssue)assert.equal((await sandbox.apply(target,await sandbox.prefix(77))).history.length,77);
  else if(invoiceDrafts)assert.equal((await sandbox.apply(target,await sandbox.prefix(76))).history.length,76);
  else if(invoicePreparation)assert.equal((await sandbox.apply(target,await sandbox.prefix(75))).history.length,75);
  else if(financeMoneyChannels)assert.equal((await sandbox.apply(target,await sandbox.prefix(74))).history.length,74);
  else if(financeCategoryMappings)assert.equal((await sandbox.apply(target,await sandbox.prefix(73))).history.length,73);
  else if(financeTaxProfiles)assert.equal((await sandbox.apply(target,await sandbox.prefix(72))).history.length,72);
  else if(financeAccounts)assert.equal((await sandbox.apply(target,await sandbox.prefix(71))).history.length,71);
  else if(pickupReturnWorkflow)assert.equal((await sandbox.apply(target,await sandbox.prefix(70))).history.length,70);
  else if(pickupTrips)assert.equal((await sandbox.apply(target,await sandbox.prefix(69))).history.length,69);
  else if(dropoffPolicyRevision)assert.equal((await sandbox.apply(target,await sandbox.prefix(68))).history.length,68);
  else if(dropoffCustody)assert.equal((await sandbox.apply(target,await sandbox.prefix(67))).history.length,67);
  else if(maintenanceFollowUp)assert.equal((await sandbox.apply(target,await sandbox.prefix(66))).history.length,66);
  else if(reviewHistory)assert.equal((await sandbox.apply(target,await sandbox.prefix(65))).history.length,65);
  else if(reviewOutcome)assert.equal((await sandbox.apply(target,await sandbox.prefix(64))).history.length,64);
  else if(mobileDeparture)assert.equal((await sandbox.apply(target,await sandbox.prefix(63))).history.length,63);
  else if(workEnd)assert.equal((await sandbox.apply(target,await sandbox.prefix(62))).history.length,62);
  else if(workStart)assert.equal((await sandbox.apply(target,await sandbox.prefix(61))).history.length,61);
  else if(workBoundary)assert.equal((await sandbox.apply(target,await sandbox.prefix(60))).history.length,60);
  else if(workTime)assert.equal((await sandbox.apply(target,await sandbox.prefix(59))).history.length,59);
  else if(unfulfilledCancellation)assert.equal((await sandbox.apply(target,await sandbox.prefix(58))).history.length,58);
  else if(supportTrips)assert.equal((await sandbox.apply(target,await sandbox.prefix(57))).history.length,57);
  else if(jobMileage)assert.equal((await sandbox.apply(target,await sandbox.prefix(56))).history.length,56);
  else if(jobCompletion)assert.equal((await sandbox.apply(target,await sandbox.prefix(55))).history.length,55);
  else if(fieldSessions){const candidate=await field54Candidate(sandbox),adopted=await sandbox.apply(target,candidate.directory);assert.equal(adopted.registrySha256,candidate.registrySha256);assert.equal(adopted.history.length,54);}
  if(invoiceIssueTaxReview&&!invoiceIssue){
   const proposal=await readFile(new URL('../../planning/proposals/finance-invoice-issue-tax-review.sql',import.meta.url),'utf8');
   await client.query('BEGIN');
   const accountReview=await readFile(new URL('../../planning/proposals/finance-invoice-issue-account-review.sql',import.meta.url),'utf8');
   try{
    await client.query(await readFile(new URL('../../planning/proposals/finance-invoice-exemption-evidence.sql',import.meta.url),'utf8'));
    await client.query(proposal);await client.query(accountReview);
    await client.query('COMMIT');
   }
   catch(error){await client.query('ROLLBACK');throw error;}
  }
  if(directReceipts){
   assert.equal((await sandbox.apply(target,await sandbox.prefix(78))).history.length,78);
  }
  if(sameDayExpenses){
   const source=trialBalance?await sandbox.prefix(80):await sandbox.prefix(79);
   assert.equal((await sandbox.apply(target,source)).history.length,trialBalance?80:79);
  }
  if(paymentCorrections){
   assert.equal((await sandbox.apply(target,await sandbox.prefix(81))).history.length,81);
  }
  if(fundApplications){
   assert.equal((await sandbox.apply(target,await sandbox.prefix(82))).history.length,82);
  }
  if(heldTips){
   if(serviceRefunds){
    const installed=await sandbox.apply(target,await sandbox.prefix(86));
    assert.equal(installed.history.length,86);
    assert.equal(installed.registrySha256,'2d1bc625ae0218a165241192e11a041190ae71d0762ca72bb23b36a2c7ec6257');
   }else{
    const candidate=await (paidInvoiceCredits?financePairedInvoiceCredit85Candidate:invoiceCredits?financeInvoiceCredit84Candidate:financeHeldTip83Candidate)(sandbox);
    const installed=await sandbox.apply(target,candidate.directory);
    assert.equal(installed.history.length,paidInvoiceCredits?85:invoiceCredits?84:83);
    assert.equal(installed.registrySha256,candidate.registrySha256);
   }
  }
  if(receivableAging&&!postedFinanceExport)assert.equal((await sandbox.apply(target,await sandbox.prefix(88))).history.length,88);
  let postedFinanceConfiguration;
  if(postedFinanceExport){
   const schemaVersion=collectionFailureRecreditExport?99:refundTransferFeeExport?98:directReceiptTipExport?97:refundTransferExport?96:collectionFailureExport?95:tipReturnExport?94:excessReturnExport?93:applyReceiptFunds?92:excessReceipts?91:customerFundsReport?90:89;
   const currentRegistry=JSON.parse(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url),'utf8'));
   const source=excessReturnExport&&currentRegistry.migrations.length===92
    ?await prepareExcessReturnCandidate(sandbox):await sandbox.prefix(schemaVersion);
   const registered=await sandbox.apply(target,source);
   assert.equal(registered.history.length,schemaVersion);
   postedFinanceLogin='crest_posted_finance_test_'+randomBytes(8).toString('hex');
   const exportSecret=randomBytes(32).toString('hex');
   await sandbox.admin.query('CREATE ROLE '+postedFinanceLogin+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+exportSecret+"'");
   await sandbox.admin.query('GRANT crest_export TO '+postedFinanceLogin+' WITH INHERIT FALSE, SET TRUE');
   const exportUrl=new URL(target);exportUrl.username=postedFinanceLogin;exportUrl.password=exportSecret;
   postedFinanceConfiguration={connectionString:exportUrl.href,appReleaseId:release,sourceSchemaVersion:registered.history.length};
  }
  if(customerFundsReport&&!postedFinanceExport)assert.equal((await sandbox.apply(target)).history.length,90);
  const compiled=await buildSourceExportBrowserFixture(sandbox.workspace),runtime=await import(pathToFileURL(compiled.server).href);
  assert(typeof googleCalendar==='boolean'&&(!googleCalendar||product&&workspace&&!paidInvoiceCredits));
  assert(typeof googleCalendarAutomatic==='boolean'&&(!googleCalendarAutomatic||googleCalendar&&scheduling));
  assert(typeof postedFinanceExport==='boolean'&&(!postedFinanceExport||product&&serviceRefunds&&!googleCalendar));
  let calendarConfiguration;
  if(googleCalendar){
   const registered=await sandbox.apply(target,await sandbox.prefix(87));
   assert.equal(registered.history.length,87);
   calendarLogin='crest_calendar_browser_'+randomBytes(8).toString('hex');
   const secret=randomBytes(32).toString('hex');
   await sandbox.admin.query('CREATE ROLE '+calendarLogin+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+secret+"'");
   await sandbox.admin.query('GRANT crest_calendar_oauth TO '+calendarLogin+' WITH INHERIT FALSE, SET TRUE');
   const calendarUrl=new URL(target);calendarUrl.username=calendarLogin;calendarUrl.password=secret;
   calendarConfiguration={connectionString:calendarUrl.href,calendarKeyMaterial:randomBytes(32)};
   if(googleCalendarAutomatic){
    calendarWorkerLogin='crest_calendar_worker_'+randomBytes(8).toString('hex');
    const workerSecret=randomBytes(32).toString('hex');
    await sandbox.admin.query('CREATE ROLE '+calendarWorkerLogin+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+workerSecret+"'");
    await sandbox.admin.query('GRANT crest_calendar_dispatch TO '+calendarWorkerLogin+' WITH INHERIT FALSE, SET TRUE');
    const workerUrl=new URL(target);workerUrl.username=calendarWorkerLogin;workerUrl.password=workerSecret;
    calendarConfiguration.worker={connectionString:workerUrl.href};
   }
  }
  login='crest_export_browser_'+randomBytes(8).toString('hex');const secret=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+secret+"'");owned=true;await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=secret;const config={connectionString:url.toString(),environment:'test'};
  service=await startRealAuthService(target,{diagnostic:amendmentAcceptance});const email='synthetic-browser-export-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url'),user=authResult(await service.admin.admin.createUser({email,password,email_confirm:true}),'export_browser_user').user;assert(user?.id);
  const sdk=service.sdk();await sdk.initialize();authResult(await sdk.signInWithPassword({email,password}),'export_browser_enrollment');const factor=authResult(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Synthetic export browser MFA'}),'export_browser_factor'),totp=URI.parse(factor.totp.uri);assert(totp instanceof TOTP);authResult(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}),'export_browser_mfa');
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;let actor,business,epoch;
  await client.query('BEGIN');try{
   actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic export browser owner',$1,$2,$3,$3,'manual') RETURNING id",[service.issuer,user.id,bootstrap])).rows[0].id;
   business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic export browser business',$2,$1,$1,'manual') RETURNING id",[actor,fieldSessions?'America/Indiana/Indianapolis':'UTC'])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
   epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  let financeConfiguration;
  if(financeAccounts){
   const candidate='crest_finance_browser_'+randomBytes(8).toString('hex'),secret=randomBytes(32).toString('hex');
   await sandbox.admin.query('CREATE ROLE '+candidate+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+secret+"'");
   financeLogin=candidate;await sandbox.admin.query('GRANT crest_finance_preview TO '+financeLogin);
   const financeUrl=new URL(target);financeUrl.username=financeLogin;financeUrl.password=secret;
   financeConfiguration={connectionString:financeUrl.href,fixedMappings:financeMappings,taxProfiles:financeTaxProfiles,categoryMappings:financeCategoryMappings,moneyChannels:financeMoneyChannels,invoicePreparation,invoiceDrafts,invoiceIssueTaxReview,invoiceIssue,directReceipts,sameDayExpenses,trialBalance,paymentCorrections,fundApplications,heldTips,invoiceCredits,paidInvoiceCredits,serviceRefunds,receivableAging,customerFundsReport,...excessReceipts?{excessReceipts}:{},...excessReturnExport?{excessReturns:true}:{},...tipReturnExport?{tipReturns:true}:{},...collectionFailureExport?{collectionFailures:true}:{},...refundTransferExport?{refundTransfers:true}:{},...directReceiptTipExport?{directReceiptTips:true}:{},...refundTransferFeeExport?{refundTransferFees:true}:{},...collectionFailureRecreditExport?{collectionFailureRecredits:true}:{}};
   await client.query("INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin) SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1",[business,actor]);
  }
  const authentication={database:config,provider:{issuer:service.issuer,publicKey:service.publicKey,environment:'test'},
   owner:{subject:user.id,factorId:factor.id},loginKey:randomBytes(32),ingress:{kind:'direct'},activeKeyId:'synthetic-browser',
   keys:[{id:'synthetic-browser',key:randomBytes(32)}]};
  const auth=(await runtime.createAuthenticationRuntime(authentication)).forServer(),
   lifecycle=runtime.createSessionLifecycle(config,auth.provider,auth.tokens),database=runtime.sessionDatabase(config);
  const issued=await lifecycle.login({email,password,factorId:factor.id,code:totp.generate()},{subject:user.id},false,signal()),credential=issued.cookieValueForResponse(),verified=await lifecycle.verify(credential,signal(),'background',true),hash=runtime.sessionCredentialHash(credential),jobId=randomUUID(),leaseId=randomUUID(),operation=randomUUID();let job;
  try{const args=[hash,verified.sessionId,actor,service.issuer,user.id,verified.provider.sessionId,new Date(verified.provider.expiresAt),business,epoch];await database.commandTransaction(q=>q('SELECT crest_commands.request_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',[...args,randomUUID(),jobId,release]),signal());job=(await database.commandTransaction(q=>q('SELECT crest_commands.claim_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',[...args,randomUUID(),jobId,'1',leaseId]),signal())).receipt.job;}finally{hash.fill(0);}
  if(financeMappings){
   const finance=await sandbox.connect(financeConfiguration.connectionString),seedHash=runtime.sessionCredentialHash(credential);
   try{
    await finance.query('SET ROLE crest_finance_preview');
    const args=[seedHash,verified.sessionId,actor,service.issuer,user.id,verified.provider.sessionId,
     new Date(verified.provider.expiresAt),business,epoch],accountId=randomUUID();
    const body={identity:{code:'4000',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'revenue'},
     name:'Fictional service revenue',active:true,reason:null};
    assert.equal((await finance.query(
     'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
     [...args,randomUUID(),accountId,body])).rows[0].result.state,'committed');
    if(financeCategoryMappings&&!sameDayExpenses){
     const candidates=[
      ...Array.from({length:25},(_,index)=>[String(5000+index),'Fictional eligible account '+(index+1),'expense',null]),
      ['5100','Fictional fuel account','expense',null],['1000','Fictional bank','asset','money'],
     ];
     for(const [code,name,accountType,controlKind] of candidates){
      const draft={identity:{code,accountType,normalSide:'debit',controlKind,reportRole:controlKind??accountType},
       name,active:true,reason:null};
      assert.equal((await finance.query(
       'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
       [...args,randomUUID(),randomUUID(),draft])).rows[0].result.state,'committed');
     }
    }
    for(const [version,id,date,reason] of [
     ['0',accountId,'2026-01-01','=Fictional initial approval'],
     ['1',accountId,'2026-04-01','Fictional approval renewed'],
     ...(!invoiceIssue?[['2',null,'2026-10-01','Fictional mapping closed']]:[]),
    ]){
     assert.equal((await finance.query(
      'SELECT crest_commands.approve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',
      [...args,randomUUID(),'service_revenue',version,id,date,reason])).rows[0].result.state,'committed');
    }
    if(invoiceIssue){
     const arId=randomUUID();
     assert.equal((await finance.query(
      'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
      [...args,randomUUID(),arId,{identity:{code:'1100',accountType:'asset',normalSide:'debit',controlKind:'ar',reportRole:'ar'},
       name:'Fictional receivables',active:true,reason:null}])).rows[0].result.state,'committed');
     assert.equal((await finance.query(
      'SELECT crest_commands.approve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',
      [...args,randomUUID(),'ar','0',arId,'2026-01-01','Fictional AR mapping'])).rows[0].result.state,'committed');
     const salesTaxId=randomUUID();
     assert.equal((await finance.query(
      'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
      [...args,randomUUID(),salesTaxId,{identity:{code:'2100',accountType:'liability',normalSide:'credit',controlKind:'tax_payable',reportRole:'tax_payable'},
       name:'Fictional sales tax payable',active:true,reason:null}])).rows[0].result.state,'committed');
     if(heldTips){
      const tipsId=randomUUID(),district='Fictional tip district';
      assert.equal((await finance.query(
       'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
       [...args,randomUUID(),tipsId,{identity:{code:'4100',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'tips_revenue'},
        name:'Fictional tip revenue',active:true,reason:null}])).rows[0].result.state,'committed');
      assert.equal((await finance.query(
       'SELECT crest_commands.approve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',
       [...args,randomUUID(),'tips_revenue','0',tipsId,'2026-01-01','Fictional tip revenue reviewed'])).rows[0].result.state,'committed');
      assert.equal((await finance.query(
       'SELECT crest_commands.approve_finance_tax_profile($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) AS result',
       [...args,randomUUID(),district,'tip',null,'0','2026-01-01','inclusive_single','0.1',
        'Fictional tax classification reviewed','Fictional tip tax approval'])).rows[0].result.state,'committed');
      assert.equal((await finance.query(
       'SELECT crest_commands.approve_invoice_tax_payable_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',
       [...args,randomUUID(),district,'0',salesTaxId,'2026-01-01','Fictional tip tax mapping reviewed'])).rows[0].result.state,'committed');
     }
     if(invoiceCredits){
      const returnsId=randomUUID(),identity={code:'4910',accountType:'contra_revenue',normalSide:'debit',
       controlKind:null,reportRole:'contra_revenue'};
      assert.equal((await finance.query(
       'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
       [...args,randomUUID(),returnsId,{identity,name:'Fictional returns',active:true,reason:null}])).rows[0].result.state,'committed');
      assert.equal((await finance.query(
       'SELECT crest_commands.approve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',
       [...args,randomUUID(),'returns','0',returnsId,'2026-01-01','Fictional returns reviewed'])).rows[0].result.state,'committed');
     }
    }
   }finally{seedHash.fill(0);await finance.end();}
  }
  if(financeMoneyChannels){
   const finance=await sandbox.connect(financeConfiguration.connectionString),seedHash=runtime.sessionCredentialHash(credential);
   try{
    await finance.query('SET ROLE crest_finance_preview');
    const args=[seedHash,verified.sessionId,actor,service.issuer,user.id,verified.provider.sessionId,
     new Date(verified.provider.expiresAt),business,epoch];
    for(const [code,controlKind,reportRole,name] of [
     ['1000','bank','money','Fictional dedicated bank'],
     ['1070','owner_custody','owner_custody','Fictional owner custody'],
     ['1030','wallet','money','Fictional dedicated wallet'],
    ]){
     const draft={identity:{code,accountType:'asset',normalSide:'debit',controlKind,reportRole},name,active:true,reason:null};
     assert.equal((await finance.query(
      'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
      [...args,randomUUID(),randomUUID(),draft])).rows[0].result.state,'committed');
    }
    if(directReceipts){
     const bank=(await client.query("SELECT id FROM crest.accounts WHERE business_id=$1 AND code='1000'",[business])).rows[0];
     assert(bank);
     const channel={identity:{accountId:bank.id,kind:'bank',ownershipScope:'dedicated_business',
      providerNamespace:'fictional-bank',maskedSuffix:'1234'},label:'Fictional checking',effectiveFrom:'2026-01-01',
      ownershipEvidence:'Fictional verified ownership',openingState:'verified_zero',openingOn:'2026-01-01',
      openingCents:'0',openingEvidence:'Fictional verified zero opening',active:true,reason:'Fictional channel review'};
     assert.equal((await finance.query(
      'SELECT crest_commands.save_money_channel($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12) AS result',
      [...args,randomUUID(),randomUUID(),channel])).rows[0].result.state,'committed');
    }
   }finally{seedHash.fill(0);await finance.end();}
  }
  let issueReviewServiceVersion;
  if(sameDayExpenses){
   const finance=await sandbox.connect(financeConfiguration.connectionString),seedHash=runtime.sessionCredentialHash(credential);
   try{
    await finance.query('SET ROLE crest_finance_preview');
    const args=[seedHash,verified.sessionId,actor,service.issuer,user.id,verified.provider.sessionId,
     new Date(verified.provider.expiresAt),business,epoch];
    const expenseAccount=randomUUID(),definition={identity:{code:'5005',accountType:'expense',normalSide:'debit',controlKind:null,reportRole:'expense'},
     name:'Fictional wash supplies',active:true,reason:null};
    assert.equal((await finance.query(
     'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
     [...args,randomUUID(),expenseAccount,definition])).rows[0].result.state,'committed');
    assert.equal((await finance.query(
     'SELECT crest_commands.approve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',
     [...args,randomUUID(),'category_supplies','0',expenseAccount,'2026-01-01','Fictional supplies account approved'])).rows[0].result.state,'committed');
    if(refundTransferFeeExport){
     const feeAccount=randomUUID();
     assert.equal((await finance.query(
      'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
      [...args,randomUUID(),feeAccount,{identity:{code:'5300',accountType:'expense',normalSide:'debit',controlKind:null,reportRole:'fee'},
       name:'Fictional provider fees',active:true,reason:null}])).rows[0].result.state,'committed');
     assert.equal((await finance.query(
      'SELECT crest_commands.approve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',
      [...args,randomUUID(),'fee','0',feeAccount,'2026-01-01','Fictional provider fee account approved'])).rows[0].result.state,'committed');
    }
    if(paymentCorrections){
     const funds=randomUUID();
     assert.equal((await finance.query(
      'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
      [...args,randomUUID(),funds,{identity:{code:'2000',accountType:'liability',normalSide:'credit',
       controlKind:'customer_funds',reportRole:'customer_funds'},name:'Fictional customer funds',active:true,reason:null}])).rows[0].result.state,'committed');
     assert.equal((await finance.query(
      'SELECT crest_commands.approve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',
      [...args,randomUUID(),'customer_funds','0',funds,'2026-01-01','Fictional customer funds approved'])).rows[0].result.state,'committed');
    }else{
     const day=(await client.query("SELECT (clock_timestamp() AT TIME ZONE 'America/Indiana/Indianapolis')::date::text AS day")).rows[0].day;
     assert.equal((await finance.query(
      'SELECT crest_commands.configure_fictional_invoice_setup($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
      [...args,randomUUID(),{kind:'accounting_period',startsOn:day,reason:'Fictional expense period approved'}])).rows[0].result.state,'committed');
    }
   }finally{seedHash.fill(0);await finance.end();}
  }
  if(financeTaxProfiles){
   const seedHash=runtime.sessionCredentialHash(credential);
   const finance=await sandbox.connect(financeConfiguration.connectionString);
   try{
    const args=[seedHash,verified.sessionId,actor,service.issuer,user.id,verified.provider.sessionId,
     new Date(verified.provider.expiresAt),business,epoch],serviceId=randomUUID();
    const definition={name:'Fictional interior detail',inclusions:'Interior cleaning',exclusions:'',internalGuidance:null,
     rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null};
    const saved=await database.commandTransaction(q=>q(
     'SELECT crest_commands.save_service($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
     [...args,randomUUID(),serviceId,{code:'fictional-interior',active:true,definition}]),signal());
    assert.equal(saved.state,'committed');
    if(invoiceIssueTaxReview)issueReviewServiceVersion=(await client.query(
     'SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',[business,serviceId])).rows[0].id;
    await finance.query('SET ROLE crest_finance_preview');
    for(const [applicability,id,version,date,treatment,rate,evidence] of [
     ['service',serviceId,'0','2026-01-01','inclusive_single','0.1','=Fictional rate evidence'],
     ...(!invoiceIssueTaxReview?[['service',serviceId,'1','2026-06-01','exempt',null,'Fictional exemption policy']]:[]),
     ['tip',null,'0','2026-01-01','non_taxable',null,'Fictional tip rule'],
    ]){
     assert.equal((await finance.query(
      'SELECT crest_commands.approve_finance_tax_profile($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) AS result',
      [...args,randomUUID(),'Fictional district',applicability,id,version,date,treatment,rate,evidence,'Fictional tax review'])).rows[0].result.state,'committed');
    }
    if(invoiceIssue)assert.equal((await finance.query(
     'SELECT crest_commands.approve_finance_tax_profile($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) AS result',
     [...args,randomUUID(),'Fictional exempt district','service',serviceId,'0','2026-01-01','exempt',null,
      'Fictional exemption policy','Fictional exempt profile approval'])).rows[0].result.state,'committed');
   }finally{seedHash.fill(0);await finance.end();}
  }
  let bookingRequest,bookingFamilyId,additionalBookingRequest,additionalBookingFamilyId,fieldVehicleId;
  if(scheduling){
   const web=await sandbox.connect(url.toString()),seedHash=runtime.sessionCredentialHash(credential);
   try{await web.query('SET ROLE crest_web');const principal=await lifecycle.verify(credential,signal(),'background',true),parent=await createConfirmedBookingFixture({client,web,bootstrap})({hash:seedHash,session:principal.sessionId,actor,issuer:service.issuer,subject:user.id,provider:principal.provider.sessionId,deadline:new Date(principal.provider.expiresAt),business,epoch},invoiceIssueTaxReview?{serviceVersionFor:()=>issueReviewServiceVersion}:googleCalendar?{
    async serviceVersionFor(calendarOwner,authorize){
     const serviceId=randomUUID(),definition={name:'Fictional Calendar interior',inclusions:'Private calendar fixture scope',
      exclusions:'',internalGuidance:'Private calendar catalog guidance',rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null};
     const saved=(await web.query('SELECT crest_commands.save_service($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',
      [...authorize(),calendarOwner.epoch,randomUUID(),serviceId,{code:'fictional-calendar-interior',active:true,definition}])).rows[0].result;
     assert.equal(saved.state,'committed');
     return (await client.query('SELECT id FROM crest.service_versions WHERE (business_id,service_id)=($1,$2)',[business,serviceId])).rows[0].id;
    }
   }:{});bookingRequest=confirmedBookingRequest(parent);bookingFamilyId=parent.familyId;if(fieldSessions){fieldVehicleId=randomUUID();const payload={label:'Synthetic field equipment rig',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'business_rig',notes:null,archived:false,archiveReason:null};assert.equal((await web.query('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS result',[...parent.auth(),epoch,randomUUID(),fieldVehicleId,payload])).rows[0].result.state,'committed');}if(additionalSchedulingAgreement||combinedSchedulingAgreements){const other=await createConfirmedBookingFixture({client,web,bootstrap})({hash:seedHash,session:principal.sessionId,actor,issuer:service.issuer,subject:user.id,provider:principal.provider.sessionId,deadline:new Date(principal.provider.expiresAt),business,epoch},combinedSchedulingAgreements?{customerId:parent.customer}:{});additionalBookingRequest=confirmedBookingRequest(other);additionalBookingFamilyId=other.familyId;}}
   finally{seedHash.fill(0);await web.end();}
  }
  let photoRuntime;
  if(photoFixture){
   const candidate='crest_photo_browser_'+randomBytes(8).toString('hex'),workerSecret=randomBytes(32).toString('hex');
   await sandbox.admin.query('CREATE ROLE '+candidate+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+workerSecret+"'");
   photoLogin=candidate;
   await sandbox.admin.query('GRANT crest_custody_photo_dispatch TO '+photoLogin);
   const workerUrl=new URL(target);
   workerUrl.username=photoLogin;workerUrl.password=workerSecret;
   photoStorage=await runtime.custodyPhotoObjects();
   const authority=runtime.createDropoffPhotoDispatcherDirectory(config,auth.provider,auth.tokens,
    {connectionString:workerUrl.toString(),environment:'test'});
   const allowed=sha(photoFixture);
   // This fixture accepts only the exact generated PNG. It cannot decode a
   // caller-provided original and does not stand in for the isolated worker.
   const imageId=process.env.CREST_CUSTODY_PHOTO_IMAGE_ID;
   const validator=imageId?runtime.createLocalSandboxValidator({imageId}):{async validate(bytes,type){
    assert.equal(type,'image/png');assert.equal(sha(bytes),allowed);
    return runtime.validateImage(bytes,type);
   }};
   photoRuntime={objects:photoStorage.store,stagingOrigin:photoStorage.origin,
    dispatch:runtime.createDropoffPhotoDispatch(authority,photoStorage.store,validator)};
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
   if(calendarConfiguration){
    const identity=runtime.syntheticGoogleCalendarIdentity;
    await client.query('INSERT INTO crest_private.google_calendar_oauth_client VALUES(true,$1,$2,$3,$4)',
     ['https://accounts.google.com',identity.clientId,origin+'/api/google-calendar/callback',identity.verifierKeyId]);
    await client.query('INSERT INTO crest_private.google_calendar_credential_key VALUES(true,$1)',[identity.credentialKeyId]);
    if(calendarWorkerLogin)await client.query('INSERT INTO crest_private.google_calendar_worker_principals(business_id,principal) VALUES($1,$2)',[business,calendarWorkerLogin]);
   }
   app=await runtime.createCrestApplication({origin,environment:'test',tls,authentication:auth,business:{businessId:business},customers:true,...workspace?{vehicles:true,associations:true,leads:true,leadConversions:true,operationResolution:true}:{},...catalog?{syntheticCatalog:true,operationResolution:true}:{sourceExports:{appReleaseId:release,store:h.store}},...quotes?{syntheticQuotes:true,operationResolution:true}:{},...quoteReview?{syntheticQuoteReview:true}:{},...quoteCommercial?{syntheticQuoteCommercial:true,operationResolution:true}:{},...appointmentHolds?{syntheticAppointmentHolds:true,operationResolution:true}:{},...expenses?{syntheticExpenses:true,operationResolution:true}:{},...calendarConfiguration?{syntheticGoogleCalendar:calendarConfiguration}:{},...postedFinanceConfiguration?{syntheticPostedFinanceExport:postedFinanceConfiguration}:{},...financeConfiguration?{syntheticFinanceAccounts:financeConfiguration}:{},...scheduling?{syntheticScheduling:true}:{},...amendments?{syntheticQuoteAmendments:true}:{},...amendmentAcceptance?{syntheticQuoteAmendmentAcceptance:true}:{},...fieldSessions?{syntheticFieldSessions:true}:{},...jobCompletion?{syntheticJobCompletion:true}:{},...jobMileage?{syntheticJobMileage:true}:{},...supportTrips?{syntheticSupportTrips:true}:{},...unfulfilledCancellation?{syntheticUnfulfilledCancellation:true}:{},...workTime?{syntheticWorkTime:true}:{},...workBoundary?{syntheticWorkBoundary:true}:{},...workStart?{syntheticWorkStart:true}:{},...workEnd?{syntheticWorkEnd:true}:{},...mobileDeparture?{syntheticMobileDeparture:true}:{},...reviewOutcome?{syntheticReviewOutcome:true}:{},...reviewHistory?{syntheticReviewHistory:true}:{},...maintenanceFollowUp?{syntheticMaintenanceFollowUp:true}:{},...dropoffCustody?{syntheticDropoffCustody:true}:{},...dropoffPolicyRevision?{syntheticDropoffPolicyRevision:true}:{},...pickupTrips?{syntheticPickupTrips:true}:{},...pickupCollection?{syntheticPickupCollection:true}:{},...pickupPolicy?{syntheticPickupPolicy:true}:{},...pickupPhotos?{syntheticPickupPhotos:true}:{},...pickupReturnWorkflow?{syntheticPickupWork:true,syntheticPickupRelease:true,syntheticPickupReturnFailure:true}:{},...photoRuntime?{syntheticDropoffPhotos:photoRuntime}:{}});server=app.server;
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
  async function authorizePostedFinance({actorId=actor,requestedBusiness=business,epochOverride=epoch,digest='a'.repeat(64),record=false,rollback=false}={}){
   const current=signal(),bound=await lifecycle.verify(credential,current,'background',true),hashed=runtime.sessionCredentialHash(credential);
   const args=[hashed,bound.sessionId,actorId,service.issuer,user.id,bound.provider.sessionId,new Date(bound.provider.expiresAt),requestedBusiness];
   let receipt;
   try{
    if(!record)return await database('SELECT crest_commands.authorize_posted_finance_export($1,$2,$3,$4,$5,$6,$7,$8) AS result',args,current);
    return await database.commandTransaction(async query=>{
     const observed=(await query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'+00:00' AS result`,[]));
     const value=await query('SELECT crest_commands.record_posted_finance_export_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',
      [...args,epochOverride,postedFinanceConfiguration.sourceSchemaVersion,release,observed,'b'.repeat(64),digest,1200]);
     if(rollback){
      receipt=value;
      throw Error('synthetic refusal before commit');
     }
     return value;
    },current);
   }catch(error){
    if(rollback&&receipt?.state==='authorized_handoff')return receipt;
    throw error;
   }finally{hashed.fill(0);}
  }
  return{origin,product,authorizePostedFinance,fieldVehicleId,bookingRequest,bookingFamilyId,additionalBookingRequest,additionalBookingFamilyId,workspace:sandbox.workspace,business,actor,jobId,plan,bytes,client,requests,storage:h,photoStorage,setupGets,facts,authDiagnostics:()=>service.diagnostics(),credentials:()=>({email,password,code:totp.generate(),trusted:false}),close};
 }catch(error){await close();throw error;}
}
