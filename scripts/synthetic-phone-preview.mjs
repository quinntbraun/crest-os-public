// Reuses the existing synthetic workspace; creates no account, database or bridge.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {parseSyntheticPhoneBinding,readSyntheticPhoneTls,restrictSyntheticPhoneSockets} from './synthetic-phone-binding.mjs';
import {requireSyntheticJobCompletion,requireSyntheticJobMileage,requireSyntheticSupportTrips,requireSyntheticUnfulfilledCancellation,requireSyntheticWorkTime,requireSyntheticWorkBoundary,requireSyntheticWorkStart,requireSyntheticWorkEnd,requireSyntheticMobileDeparture,requireSyntheticReviewOutcome,requireSyntheticReviewHistory,requireSyntheticMaintenanceFollowUp,requireSyntheticDropoffCustody,requireSyntheticDropoffPolicyRevision,requireSyntheticPickupCustody,requireSyntheticFinanceAccountConfiguration} from './synthetic-migrations.mjs';
import {readSyntheticFinancePreview} from './synthetic-finance-preview.mjs';
import {readSyntheticPostedFinancePreview} from './synthetic-posted-finance-preview.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),directory=join(root,'.local/synthetic-workspace');let app;
try{
 const options=process.argv.slice(2),jobCompletion=options.includes('--job-completion'),jobMileage=options.includes('--job-mileage'),supportTrips=options.includes('--support-trips'),unfulfilledCancellation=options.includes('--unfulfilled-cancellation'),workTime=options.includes('--work-time'),workBoundary=options.includes('--work-boundary'),workStart=options.includes('--work-start'),workEnd=options.includes('--work-end'),mobileDeparture=options.includes('--mobile-departure'),reviewOutcome=options.includes('--review-outcome'),reviewHistory=options.includes('--review-history'),maintenanceFollowUp=options.includes('--maintenance-follow-up'),dropoffCustody=options.includes('--dropoff-custody'),dropoffPolicyRevision=options.includes('--dropoff-policy-revision'),pickupCustody=options.includes('--pickup-custody'),financeAccounts=options.includes('--finance-accounts'),taxProfiles=options.includes('--tax-profiles'),categoryMappings=options.includes('--expense-category-mappings'),moneyChannels=options.includes('--money-channels'),invoicePreparation=options.includes('--invoice-preparation'),invoiceDrafts=options.includes('--invoice-drafts'),invoiceIssue=options.includes('--invoice-issue'),directReceipts=options.includes('--direct-receipts'),sameDayExpenses=options.includes('--same-day-expenses'),trialBalance=options.includes('--trial-balance'),paymentCorrections=options.includes('--payment-corrections'),fundApplications=options.includes('--fund-applications'),heldTips=options.includes('--held-tips'),invoiceCredits=options.includes('--invoice-credits'),paidInvoiceCredits=options.includes('--paid-invoice-credits'),serviceRefunds=options.includes('--service-refunds'),receivableAging=options.includes('--receivable-aging'),customerFundsReport=options.includes('--customer-funds-report'),postedFinanceExport=options.includes('--posted-finance-export'),excessReceipts=options.includes('--excess-receipts');
 assert(!directReceipts||invoiceIssue&&moneyChannels,'Invoice issue and reviewed money channels are required for direct receipts');
 assert(!sameDayExpenses||directReceipts&&categoryMappings,'Expense posting requires reviewed categories and direct receipts');
 assert(!fundApplications||paymentCorrections,'Fund applications require registered payment corrections');
 assert(!heldTips||fundApplications&&taxProfiles,'Held tips require registered fund applications and tax profiles');
 assert(!invoiceCredits||heldTips,'Invoice credits require registered held tips');
 assert(!paidInvoiceCredits||invoiceCredits,'Paid invoice credits require registered invoice credits');
 assert(!serviceRefunds||paidInvoiceCredits&&directReceipts,'Service refunds require registered paid invoice credits and direct receipts');
 assert(!excessReceipts||customerFundsReport&&postedFinanceExport,'Excess receipts require the registered customer funds report and private finance export');
 assert(!customerFundsReport||serviceRefunds,'Customer funds reporting requires the registered refund ledger');
 assert(!receivableAging||serviceRefunds,'Receivable aging requires the registered refund ledger');
 assert(!postedFinanceExport||serviceRefunds,'Posted finance export requires the registered refund ledger');
 assert(!paymentCorrections||trialBalance,'Payment corrections require the registered posted reports');
 assert(!trialBalance||sameDayExpenses,'The posted reports require the registered expense ledger');
 assert(!invoiceIssue||invoiceDrafts&&taxProfiles,'Invoice drafts and tax profiles are required for invoice issue');
 assert(!invoiceDrafts||invoicePreparation,'Invoice preparation setup is required for invoice drafts');
 assert(!invoicePreparation||financeAccounts&&jobCompletion,'Finance account and completed-job setup are required for invoice preparation');
 assert(!(taxProfiles||categoryMappings||moneyChannels)||financeAccounts,'Finance account setup is required for tax, category mappings and money channels');
 assert(!workBoundary||workTime,'Work-time review is required for corrections');
 assert(!workStart||workBoundary,'Work-time correction setup is required before first-start correction');
 assert(!workEnd||workStart&&jobCompletion,'First-start correction and completion setup are required before completion-time correction');
 assert(!mobileDeparture||workEnd&&jobMileage,'Completion-time correction and job mileage setup are required before departure correction');
 assert(!reviewOutcome||jobCompletion,'Job completion setup is required before recording a review outcome');
 assert(!reviewHistory||reviewOutcome,'Review outcome setup is required before opening message history');
 assert(!dropoffCustody||jobCompletion&&unfulfilledCancellation,'Completion and no-work cancellation setup are required before Drop-Off custody');
 assert(!dropoffPolicyRevision||dropoffCustody,'Drop-Off custody setup is required before policy revision');
 assert(!pickupCustody||dropoffPolicyRevision,'Drop-Off policy revision setup is required before pickup custody');
 assert(!maintenanceFollowUp||reviewHistory,'Review history setup is required before opening maintenance reminders');
 assert.equal(process.platform,'win32');assert.equal(options.length,Number(jobCompletion)+Number(jobMileage)+Number(supportTrips)+Number(unfulfilledCancellation)+Number(workTime)+Number(workBoundary)+Number(workStart)+Number(workEnd)+Number(mobileDeparture)+Number(reviewOutcome)+Number(reviewHistory)+Number(maintenanceFollowUp)+Number(dropoffCustody)+Number(dropoffPolicyRevision)+Number(pickupCustody)+Number(financeAccounts)+Number(taxProfiles)+Number(categoryMappings)+Number(moneyChannels)+Number(invoicePreparation)+Number(invoiceDrafts)+Number(invoiceIssue)+Number(directReceipts)+Number(sameDayExpenses)+Number(trialBalance)+Number(paymentCorrections)+Number(fundApplications)+Number(heldTips)+Number(invoiceCredits)+Number(paidInvoiceCredits)+Number(serviceRefunds)+Number(receivableAging)+Number(customerFundsReport)+Number(excessReceipts)+Number(postedFinanceExport));
 const state=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
 assert(state.schemaVersion===1&&/^[a-f0-9]{16}$/.test(state.id)&&state.databaseName===`crest_migrate_${state.id}`&&state.login===`crest_local_${state.id}`&&state.issuer==='http://127.0.0.1:54328/auth/v1'&&state.origin==='https://127.0.0.1:4319');
 const status=JSON.parse(execFileSync('C:/Program Files/NetBird/netbird.exe',['status','--json'],{stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:262144}).toString());
 const binding=parseSyntheticPhoneBinding(JSON.parse(await readFile(join(directory,'phone-preview.json'),'utf8')),status,state.id),tls=await readSyntheticPhoneTls(directory,binding);
 const provider=await fetch(state.issuer+'/.well-known/jwks.json',{redirect:'error',signal:AbortSignal.timeout(5000)});assert(provider.ok,'START_LOOPBACK_WORKSPACE_FIRST');await provider.body?.cancel();
 process.env.NODE_ENV='production';
 const {createCrestApplication,createAuthenticationRuntime}=await import('../.local/server/application.mjs');
 const connectionString=`postgresql://${state.login}:${state.loginPassword}@127.0.0.1:54329/${state.databaseName}`;
 if(jobCompletion)await requireSyntheticJobCompletion(connectionString);
 if(jobMileage)await requireSyntheticJobMileage(connectionString);
 if(supportTrips)await requireSyntheticSupportTrips(connectionString);
 if(unfulfilledCancellation)await requireSyntheticUnfulfilledCancellation(connectionString);
 if(workTime)await requireSyntheticWorkTime(connectionString);
 if(workBoundary)await requireSyntheticWorkBoundary(connectionString);
 if(workStart)await requireSyntheticWorkStart(connectionString);
 if(workEnd)await requireSyntheticWorkEnd(connectionString);
 if(mobileDeparture)await requireSyntheticMobileDeparture(connectionString);
 if(reviewOutcome)await requireSyntheticReviewOutcome(connectionString);
 if(reviewHistory)await requireSyntheticReviewHistory(connectionString);
 if(maintenanceFollowUp)await requireSyntheticMaintenanceFollowUp(connectionString);
 if(dropoffCustody)await requireSyntheticDropoffCustody(connectionString);
   let financePreview,exportPreview;
   if(dropoffPolicyRevision||financeAccounts){
    const migrationCheck=new URL(connectionString);
    migrationCheck.username='supabase_admin';
    migrationCheck.password=state.databasePassword;
    if(dropoffPolicyRevision)await requireSyntheticDropoffPolicyRevision(migrationCheck.href);
    if(pickupCustody)await requireSyntheticPickupCustody(migrationCheck.href);
    if(financeAccounts){
     await requireSyntheticFinanceAccountConfiguration(migrationCheck.href,state.businessId,taxProfiles,categoryMappings,moneyChannels,invoicePreparation,invoiceDrafts,invoiceIssue,directReceipts,sameDayExpenses,trialBalance,paymentCorrections,fundApplications,heldTips,invoiceCredits,paidInvoiceCredits,serviceRefunds,receivableAging,customerFundsReport,excessReceipts);
     financePreview=await readSyntheticFinancePreview(directory,state,taxProfiles,categoryMappings,moneyChannels,invoicePreparation,invoiceDrafts,invoiceIssue,directReceipts,sameDayExpenses,trialBalance,paymentCorrections,fundApplications,heldTips,invoiceCredits,paidInvoiceCredits,serviceRefunds,receivableAging,customerFundsReport,excessReceipts);
     if(postedFinanceExport)exportPreview=await readSyntheticPostedFinancePreview(root,directory,state,migrationCheck.href);
    }
   }
 const runtime=await createAuthenticationRuntime({database:{connectionString,environment:'test'},provider:{issuer:state.issuer,publicKey:state.publicKey,environment:'test'},owner:state.owner,loginKey:Buffer.from(state.loginKey,'base64url'),ingress:{kind:'direct'},activeKeyId:'synthetic',keys:[{id:'synthetic',key:Buffer.from(state.tokenKey,'base64url')}]});
 app=await createCrestApplication({origin:binding.origin,environment:'test',tls,authentication:runtime.forServer(),business:{businessId:state.businessId},customers:true,vehicles:true,associations:true,leads:true,leadConversions:true,operationResolution:true,syntheticCatalog:true,syntheticQuotes:true,syntheticQuoteReview:true,syntheticAppointmentHolds:true,syntheticQuoteCommercial:true,syntheticQuoteAmendments:true,syntheticQuoteAmendmentAcceptance:true,syntheticExpenses:true,syntheticFinanceAccounts:financePreview,syntheticPostedFinanceExport:exportPreview,syntheticScheduling:true,syntheticFieldSessions:true,syntheticJobCompletion:jobCompletion,syntheticJobMileage:jobMileage,syntheticSupportTrips:supportTrips,syntheticUnfulfilledCancellation:unfulfilledCancellation,syntheticWorkTime:workTime,syntheticWorkBoundary:workBoundary,syntheticWorkStart:workStart,syntheticWorkEnd:workEnd,syntheticMobileDeparture:mobileDeparture,syntheticReviewOutcome:reviewOutcome,syntheticReviewHistory:reviewHistory,syntheticMaintenanceFollowUp:maintenanceFollowUp,syntheticDropoffCustody:dropoffCustody,syntheticDropoffPolicyRevision:dropoffPolicyRevision,syntheticPickupTrips:pickupCustody,syntheticPickupCollection:pickupCustody,syntheticPickupPolicy:pickupCustody});
 restrictSyntheticPhoneSockets(app.server,binding);
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(4319,binding.laptopAddress,resolve);});
 console.log('Private synthetic Crest preview: '+binding.origin+' . Only the two configured device addresses are accepted. Genuine sign-in required. Review any local certificate warning yourself. Keep workspace:start running.');
 const close=async()=>{await app.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);
}catch{
 if(app)await app.close().catch(()=>undefined);
 console.error('SYNTHETIC_PHONE_PREVIEW_REVIEW_REQUIRED: existing loopback workspace and saved data were not reset.');process.exitCode=1;
}
