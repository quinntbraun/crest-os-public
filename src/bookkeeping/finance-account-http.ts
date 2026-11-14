import 'server-only';
import {createHash} from 'node:crypto';
import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
import {privateJsonResponse,readNestedJsonBody} from '../security/private-http.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {financePreviewDatabase} from '../security/session-database.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {
 financeAccountCode,financeAccountReviewReason,parseFinanceAccountDraft,parseFinanceAccountHistory,parseFinanceAccountPage,
 parseFinanceAccountReceipt,parseFinanceAccountReference,parseFinanceAccountResolution,requireFinanceAccount as check,
} from './finance-account-contract.ts';
import {
 expenseCategoryMappingPurpose,fixedFinanceMappingPurpose,parseExpenseCategoryMappingAccounts,parseFinanceMappingApproval,parseFinanceMappingAt,parseFinanceMappingEditor,parseFinanceMappingHistory,
 parseFinanceMappingOperation,parseFinanceMappingReference,
} from './finance-mapping-contract.ts';
import type {FinanceMappingPurpose} from './finance-mapping-contract.ts';

import {
 financeTaxCents,matchesFinanceTaxApproval,parseFinanceTaxApproval,parseFinanceTaxHistory,parseFinanceTaxOperation,
 parseFinanceTaxPreview,parseFinanceTaxReference,parseFinanceTaxScope,
} from './finance-tax-contract.ts';

import {
 moneyChannelKind,moneyChannelScope,moneyChannelReceiptMatches,parseMoneyChannelAccounts,parseMoneyChannelDraft,
 parseMoneyChannelHistory,parseMoneyChannelOperation,parseMoneyChannelPage,parseMoneyChannelReference,
} from './finance-money-channel-contract.ts';

import {parseInvoicePreparation} from './invoice-preparation-contract.ts';
import {parseInvoiceDraftInput,parseInvoiceDraftOperation,parseInvoiceDraftPage,parseInvoiceDraftRead,parseInvoiceDraftReference} from './invoice-draft-contract.ts';

import {parseInvoiceIssueReadiness,parseInvoiceIssueTaxRequest} from './invoice-issue-tax-review-contract.ts';
import {parseInvoiceIssueReference,parseInvoiceIssueRequest,parseInvoiceIssueResult,parseIssuedInvoice,
 parseReviewedInvoiceIssue} from './issued-invoice-contract.ts';
import {invoiceTaxJurisdiction,parseInvoiceTaxMappingApproval,parseInvoiceTaxMappingEditor,parseInvoiceTaxMappingReference,parseInvoiceTaxMappingResult}
 from './invoice-tax-payable-contract.ts';
import {parseInvoiceExemptionApproval,parseInvoiceExemptionEditor,parseInvoiceExemptionResult,parseInvoiceExemptionTarget}
 from './invoice-exemption-contract.ts';
import {parseInvoiceSetupRead,parseInvoiceSetupResult,parseInvoiceSetupWrite} from './invoice-setup-contract.ts';
import {directReceiptMatchesInput,directReceiptRefusals,parseDirectReceiptInput,parseDirectReceiptOptions,
 parseDirectReceiptReference,parseDirectReceiptResult} from './direct-receipt-contract.ts';
import {parseSameDayExpenseInput,parseSameDayExpenseOptions,parseSameDayExpenseReference,parseSameDayExpenseResult,
 sameDayExpenseMatchesInput,sameDayExpenseRefusals} from './expenses/same-day-expense-contract.ts';
import {fictionalJournalPageSize,parseFictionalJournal,parseFictionalTrialBalance} from './trial-balance-contract.ts';
import {fictionalJournalV2PageSize,parseFictionalJournalV2,parseFictionalTrialBalanceV2} from './posted-report-v2-contract.ts';
import {fictionalJournalV3PageSize,parseFictionalJournalV3,parseFictionalTrialBalanceV3} from './posted-report-v3-contract.ts';
import {fictionalJournalV4PageSize,parseFictionalJournalV4,parseFictionalTrialBalanceV4} from './posted-report-v4-contract.ts';
import {fictionalJournalV5PageSize,parseFictionalJournalV5,parseFictionalTrialBalanceV5} from './posted-report-v5-contract.ts';
import {fictionalJournalV6PageSize,parseFictionalJournalV6,parseFictionalTrialBalanceV6} from './posted-report-v6-contract.ts';
import {parseReceivableAging} from './receivable-aging-contract.ts';
import {invoiceCreditMatchesInput,invoiceCreditRefusal,parseInvoiceCreditInput,parseInvoiceCreditOptions,
 parseInvoiceCreditReference,parseInvoiceCreditResult} from './invoice-credit-contract.ts';
import {pairedInvoiceCreditRefusal,parsePairedInvoiceCreditInput,parsePairedInvoiceCreditOptions,
 parsePairedInvoiceCreditReference,parsePairedInvoiceCreditResolution,parsePairedInvoiceCreditResult} from './paired-invoice-credit-contract.ts';
import {parseServiceRefundCredits,parseServiceRefundInput,parseServiceRefundOptions,parseServiceRefundReference,parseServiceRefundResult,
 serviceRefundMatchesInput,serviceRefundRefusal} from './service-refund-contract.ts';
import {heldTipMatchesInput,parseHeldTipInput,parseHeldTipOptions,parseHeldTipReference,parseHeldTipResult} from './held-tip-contract.ts';
import {fundApplicationMatchesInput,parseFundApplicationInput,parseFundApplicationOptions,
 parseFundApplicationReference,parseFundApplicationResult} from './fund-application-contract.ts';
import {allocationUnapplicationMatchesInput,parseAllocationUnapplicationInput,parseAllocationUnapplicationOptions,
 parseAllocationUnapplicationReference,parseAllocationUnapplicationResult,parseInvoicePaymentAllocations} from './allocation-unapplication-contract.ts';

export const financeAccountPrefix='/api/business/finance-accounts/';
const fields={context:[],list:['afterCode','includeArchived'],history:['accountId','afterVersion'],
 operation:['operationId','recoveryEpoch','accountId','expectedVersion'],save:['reference','draft'],
 retire:['reference','reviewEpoch','reason'], 'mapping-at':['purpose','date'],
 'mapping-history':['purpose','beforeVersion'], 'mapping-editor':['purpose'], 'mapping-category-accounts':['purpose','afterCode'],
 'mapping-operation':['operationId','recoveryEpoch','purpose','expectedVersion'],
 'mapping-approve':['reference','approval'], 'mapping-retire':['reference','reviewEpoch','reason'],
 'tax-history':['jurisdiction','applicability','serviceId','beforeVersion'],
 'tax-preview':['jurisdiction','applicability','serviceId','date','grossCents','discountCents'],
 'tax-operation':['operationId','recoveryEpoch','expectedVersion'], 'tax-approve':['reference','approval'],
 'tax-retire':['reference','reviewEpoch','reason'],
 'channel-list':['afterChannel'], 'channel-history':['channelId','beforeVersion'],
 'channel-accounts':['kind','ownershipScope','afterCode'], 'channel-lookup':['operationId','recoveryEpoch','channelId','expectedVersion'],
 'channel-save':['reference','draft'], 'channel-retire':['reference','reviewEpoch','reason'],
 'invoice-preparation':['jobId'], 'invoice-issue-tax-review':['draftId','revision','jurisdictions'],
 'invoice-issue-prepare':['draftId','revision','jurisdictions'],
 'invoice-issue-submit':['reference','jurisdictions','reviewDigest'],
 'invoice-issue-lookup':['operationId','recoveryEpoch','draftId','revision'],
 'invoice-issue-retire':['reference','reviewEpoch','reason'],
 'invoice-issue-read':['draftId'],
 'invoice-issue-tax-mapping-read':['jurisdiction'],
 'invoice-issue-tax-mapping-approve':['approval'],
 'invoice-issue-tax-mapping-lookup':['operationId','recoveryEpoch','jurisdiction','expectedVersion'],
 'invoice-issue-exemption-read':['draftId','draftRevision','outcomeId','jurisdiction','profileId'],
 'invoice-issue-exemption-approve':['approval'],
 'invoice-setup-read':['requestedOn'],
 'invoice-setup-save':['operationId','recoveryEpoch','request'],
 'receipt-options':['customerId','actualOn'],
 'receipt-record':['reference','customerId','channelId','channelVersion','actualOn','grossCents','confirmation','distinctReason','externalIdentity','applications'],
 'receipt-lookup':['operationId','recoveryEpoch','paymentId'],
 'receipt-retire':['reference','reviewEpoch','reason'],
 'payment-correction-list':['customerId','invoiceId'],
 'payment-correction-options':['customerId','allocationId','effectiveOn'],
 'payment-correction-submit':['reference','allocationId','customerId','fundsMappingId','effectiveOn','firstCent','lastCent','reason'],
 'payment-correction-lookup':['operationId','recoveryEpoch','unapplicationId'],
 'payment-correction-retire':['reference','reviewEpoch','reason'],
 'fund-application-options':['customerId','invoiceId','effectiveOn'],
 'fund-application-submit':['reference','fundLotId','receivableId','customerId','effectiveOn','firstCent','lastCent','reason'],
 'fund-application-lookup':['operationId','recoveryEpoch','fundApplicationId'],
 'fund-application-retire':['reference','reviewEpoch','reason'],
 'held-tip-options':['customerId','jurisdiction','effectiveOn'],
 'held-tip-submit':['reference','fundLotId','customerId','effectiveOn','firstCent','lastCent','jurisdiction',
  'taxProfileId','revenueMappingId','taxMappingId','customerIntentEvidence','reason'],
 'held-tip-lookup':['operationId','recoveryEpoch','tipRealizationId'],
 'held-tip-retire':['reference','reviewEpoch','reason'],
 'invoice-credit-options':['customerId','invoiceId','effectiveOn'],
 'invoice-credit-submit':['reference','invoiceItemId','customerId','effectiveOn','firstCent','lastCent','returnsMappingId','reason'],
 'invoice-credit-lookup':['operationId','recoveryEpoch','invoiceCreditId'],
 'invoice-credit-retire':['reference','reviewEpoch','reason'],
 'paid-invoice-credit-options':['customerId','invoiceId','allocationId','effectiveOn'],
 'paid-invoice-credit-submit':['credit','release','reviewedArCents'],
 'paid-invoice-credit-lookup':['operationId','recoveryEpoch','invoiceCreditId','unapplicationId'],
 'paid-invoice-credit-retire':['reference','reviewEpoch','reason'],
 'service-refund-credits':['customerId','invoiceId'],
 'service-refund-options':['customerId','pairedCreditId','actualOn'],
 'service-refund-submit':['reference','pairedCreditId','fundLotId','customerId','channelId','channelVersion',
  'actualOn','firstCent','lastCent','confirmation','reason','externalIdentity'],
 'service-refund-lookup':['operationId','recoveryEpoch','serviceRefundId'],
 'service-refund-retire':['reference','reviewEpoch','reason'],
 'expense-post-options':['expenseId'],
 'expense-post-submit':['reference','expenseId','expenseRevision','channelId','channelVersion','mappingId','incurredOn','paidOn',
  'purchaseTaxTreatment','purchaseTaxCents','receiptId','missingReceiptReason','unknownVendorReason','reviewReason','externalIdentity'],
 'expense-post-lookup':['operationId','recoveryEpoch','postedExpenseId'],
 'expense-post-retire':['reference','reviewEpoch','reason'],
 'trial-balance':['throughOn'],
 'receivable-aging':['throughOn'],
 'posted-journal':['throughOn','accountId','afterLineId'],
 'invoice-draft-list':['jobId','afterDraft'], 'invoice-draft-read':['draftId','revision'],
 'invoice-draft-lookup':['operationId','recoveryEpoch','draftId','jobId','expectedRevision'],
 'invoice-draft-save':['reference','draft'], 'invoice-draft-retire':['reference','reviewEpoch','reason']} as const;
const authority='$1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid';
type Config=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};

export function financeAccountFailure(status:400|404|405|503=400){
 const response=privateJsonResponse({error:'FINANCE_ACCOUNT_REQUEST_FAILED'},status);
 if(status===405)response.headers.set('Allow','POST');
 return response;
}

export function createFinanceAccountHttp(config:Config,connectionString:string,
 provider:Parameters<typeof createSessionLifecycle>[1],tokens:Parameters<typeof createSessionLifecycle>[2],{fixedMappings=false,taxProfiles=false,categoryMappings=false,moneyChannels=false,invoicePreparation=false,invoiceDrafts=false,invoiceIssueTaxReview=false,invoiceIssue=false,directReceipts=false,sameDayExpenses=false,trialBalance=false,paymentCorrections=false,fundApplications=false,heldTips=false,invoiceCredits=false,paidInvoiceCredits=false,serviceRefunds=false,receivableAging=false}:Readonly<{
  fixedMappings?:boolean;taxProfiles?:boolean;categoryMappings?:boolean;moneyChannels?:boolean;invoicePreparation?:boolean;invoiceDrafts?:boolean;invoiceIssueTaxReview?:boolean;invoiceIssue?:boolean;directReceipts?:boolean;sameDayExpenses?:boolean;trialBalance?:boolean;paymentCorrections?:boolean;fundApplications?:boolean;heldTips?:boolean;invoiceCredits?:boolean;paidInvoiceCredits?:boolean;serviceRefunds?:boolean;receivableAging?:boolean;
 }>={}){
 check(config.environment==='test'&&customerUuid(config.businessId)&&(!categoryMappings||fixedMappings)&&(!invoiceDrafts||invoicePreparation)&&(!invoiceIssueTaxReview||invoiceDrafts&&taxProfiles)&&(!invoiceIssue||invoiceIssueTaxReview&&fixedMappings)&&(!directReceipts||invoiceIssue&&moneyChannels));
 check((!sameDayExpenses||directReceipts&&categoryMappings)&&(!trialBalance||sameDayExpenses));
 check(!paymentCorrections||trialBalance);
 check(!fundApplications||paymentCorrections);
 check(!heldTips||fundApplications&&taxProfiles);
 check(!invoiceCredits||heldTips);
 check(!paidInvoiceCredits||invoiceCredits);
 check(!serviceRefunds||paidInvoiceCredits&&directReceipts);
 check(typeof receivableAging==='boolean'&&(!receivableAging||serviceRefunds));
 const ownerDb=new URL(config.connectionString),financeDb=new URL(connectionString);
 check(ownerDb.hostname===financeDb.hostname&&ownerDb.port===financeDb.port
  &&ownerDb.pathname===financeDb.pathname&&ownerDb.username!==financeDb.username);
 const database=financePreviewDatabase({connectionString,environment:'test'});
 const transport=createTrustedTransport(config),protect=createRequestProtection(config);
 const csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
 const sessions=createSessionLifecycle(config,provider,tokens),context=createBusinessSettingsContextReader(config,provider,tokens);
 const businessId=config.businessId;
 const mappingPurpose=(value:unknown):value is FinanceMappingPurpose=>
  fixedFinanceMappingPurpose(value)||categoryMappings&&expenseCategoryMappingPurpose(value);
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{
  let submitted=false,credentialHash:Buffer|undefined;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);
   transport(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(financeAccountPrefix.length) as keyof typeof fields;
   if(url.search||url.hash||!url.pathname.startsWith(financeAccountPrefix)||!Object.hasOwn(fields,route))return financeAccountFailure(404);
   if(!fixedMappings&&route.startsWith('mapping-')||!taxProfiles&&route.startsWith('tax-')||!moneyChannels&&route.startsWith('channel-')||!invoicePreparation&&route==='invoice-preparation'||!invoiceDrafts&&route.startsWith('invoice-draft-'))return financeAccountFailure(404);
   if(route==='invoice-issue-tax-review'&&!invoiceIssueTaxReview)return financeAccountFailure(404);
   if(route.startsWith('invoice-issue-')&&route!=='invoice-issue-tax-review'&&!invoiceIssue)return financeAccountFailure(404);
   if(route.startsWith('invoice-setup-')&&!invoiceIssue)return financeAccountFailure(404);
   if(route.startsWith('receipt-')&&!directReceipts)return financeAccountFailure(404);
   if(route.startsWith('payment-correction-')&&!paymentCorrections)return financeAccountFailure(404);
   if(route.startsWith('fund-application-')&&!fundApplications)return financeAccountFailure(404);
   if(route.startsWith('held-tip-')&&!heldTips)return financeAccountFailure(404);
   if(route.startsWith('invoice-credit-')&&!invoiceCredits)return financeAccountFailure(404);
   if(route.startsWith('paid-invoice-credit-')&&!paidInvoiceCredits)return financeAccountFailure(404);
   if(route.startsWith('service-refund-')&&!serviceRefunds)return financeAccountFailure(404);
   if(route.startsWith('expense-post-')&&!sameDayExpenses)return financeAccountFailure(404);
   if((route==='trial-balance'||route==='posted-journal')&&!trialBalance)return financeAccountFailure(404);
   if(route==='receivable-aging'&&!receivableAging)return financeAccountFailure(404);
   if(request.method!=='POST')return financeAccountFailure(405);
   protect.requireOrigin(request);
   const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;
   check(cookie);
   const input=await readNestedJsonBody(bounded,fields[route],route.startsWith('invoice-issue-')?131072:route==='receipt-record'||route==='expense-post-submit'?32768:8192);
   const sessionId=await csrf(bounded,cookie,signal);
   const binding=createHash('sha256').update('crest.finance.account.edit.v1\0').update(businessId).update('\0')
    .update(sessionId).digest('base64url');
   if(route!=='context')check(request.headers.get('X-Crest-Edit-Binding')===binding);
   if(!await admit(cookie,'ordinary',signal)){
    const response=privateJsonResponse({error:'FINANCE_ACCOUNT_REQUEST_LIMITED'},429);
    response.headers.set('Retry-After','60');return response;
   }
   if(route==='context'){
    const c=(await context(cookie,businessId,signal)).forServer();
    const response=privateJsonResponse({businessId,recoveryEpoch:c.recoveryEpoch,writeState:c.writeState});
    response.headers.set('X-Crest-Edit-Binding',binding);
    if(fixedMappings)response.headers.set('X-Crest-Finance-Fixed-Mappings','1');
    if(taxProfiles)response.headers.set('X-Crest-Finance-Tax-Profiles','1');
    if(categoryMappings)response.headers.set('X-Crest-Finance-Category-Mappings','1');
    if(moneyChannels)response.headers.set('X-Crest-Finance-Money-Channels','1');
    if(invoicePreparation)response.headers.set('X-Crest-Invoice-Preparation','1');
    if(invoiceDrafts)response.headers.set('X-Crest-Invoice-Drafts','1');
    if(invoiceIssueTaxReview)response.headers.set('X-Crest-Invoice-Issue-Tax-Review','1');
    if(invoiceIssue)response.headers.set('X-Crest-Invoice-Issue','1');
    if(directReceipts)response.headers.set('X-Crest-Direct-Receipts','1');
    if(paymentCorrections)response.headers.set('X-Crest-Payment-Corrections','1');
    if(fundApplications)response.headers.set('X-Crest-Fund-Applications','1');
    if(heldTips)response.headers.set('X-Crest-Held-Tips','1');
    if(invoiceCredits)response.headers.set('X-Crest-Invoice-Credits','1');
    if(paidInvoiceCredits)response.headers.set('X-Crest-Paid-Invoice-Credits','1');
    if(serviceRefunds)response.headers.set('X-Crest-Service-Refunds','1');
    if(receivableAging)response.headers.set('X-Crest-Receivable-Aging','1');
    if(sameDayExpenses)response.headers.set('X-Crest-Same-Day-Expenses','1');
    if(trialBalance)response.headers.set('X-Crest-Trial-Balance','1');
    return response;
   }
   credentialHash=sessionCredentialHash(cookie);
   const verified=await sessions.verify(cookie,signal,'background');
   check(!signal.aborted&&sessionId===verified.sessionId);
   const args=[credentialHash,sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,
    verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId];
   if(route==='service-refund-credits'){
    const {customerId,invoiceId}=input;
    check(customerUuid(customerId)&&customerUuid(invoiceId));
    const value=await database('SELECT crest_commands.list_fictional_service_refund_credits('+authority+',$9::uuid,$10::uuid) AS result',
     [...args,customerId,invoiceId],signal);
    parseServiceRefundCredits(value,businessId,customerId,invoiceId);
    return privateJsonResponse(value as object);
   }
   if(route==='service-refund-options'){
    const {customerId,pairedCreditId,actualOn}=input;
    check(customerUuid(customerId)&&customerUuid(pairedCreditId)&&customerDate(actualOn));
    const value=await database('SELECT crest_commands.read_fictional_service_refund_options('+authority+',$9::uuid,$10::uuid,$11::date) AS result',
     [...args,customerId,pairedCreditId,actualOn],signal);
    parseServiceRefundOptions(value,businessId,customerId,pairedCreditId,actualOn);
    return privateJsonResponse(value as object);
   }
   if(route==='service-refund-lookup'||route==='service-refund-retire'){
    const reference=parseServiceRefundReference(route==='service-refund-lookup'?input:input.reference);
    const {recoveryEpoch,operationId,serviceRefundId}=reference;
    if(route==='service-refund-lookup'){
     const value=await database('SELECT crest_commands.lookup_fictional_service_refund('+authority+',$9::uuid,$10::uuid,$11::uuid) AS result',
      [...args,recoveryEpoch,operationId,serviceRefundId],signal);
     const result=parseServiceRefundResult(value,businessId,reference);
     return privateJsonResponse(value as object,result.state==='conflict'?409:200);
    }
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_fictional_service_refund('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::text) AS result',
      [...args,input.reviewEpoch,operationId,recoveryEpoch,serviceRefundId,input.reason]);
     const parsed=parseServiceRefundResult(value,businessId,reference);
     check(parsed.state!=='absent'&&(parsed.state!=='retired'||parsed.receipt.reviewEpoch===input.reviewEpoch));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='service-refund-submit'){
    const refund=parseServiceRefundInput(input),{recoveryEpoch,operationId,serviceRefundId}=refund.reference;
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.record_fictional_service_refund('+authority+
      ',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::uuid,$15::uuid,$16::bigint,$17::date,$18::bigint,$19::bigint,$20::text,$21::text,$22::jsonb) AS result',
     [...args,recoveryEpoch,operationId,serviceRefundId,refund.pairedCreditId,refund.fundLotId,refund.customerId,refund.channelId,
      refund.channelVersion,refund.actualOn,refund.firstCent,refund.lastCent,refund.confirmation,refund.reason,refund.externalIdentity]);
     const parsed=parseServiceRefundResult(value,businessId,refund.reference);
     check(parsed.state==='conflict'||parsed.state==='committed'&&serviceRefundMatchesInput(parsed.receipt,refund));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='paid-invoice-credit-options'){
    const {customerId,invoiceId,allocationId,effectiveOn}=input;
    check(customerUuid(customerId)&&customerUuid(invoiceId)&&customerUuid(allocationId)&&(effectiveOn===null||customerDate(effectiveOn)));
    const value=await database('SELECT crest_commands.read_fictional_paired_invoice_credit_options('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::date) AS result',
     [...args,customerId,invoiceId,allocationId,effectiveOn],signal);
    parsePairedInvoiceCreditOptions(value,businessId,customerId,invoiceId,allocationId,effectiveOn);
    return privateJsonResponse(value as object);
   }
   if(route==='paid-invoice-credit-lookup'||route==='paid-invoice-credit-retire'){
    const reference=parsePairedInvoiceCreditReference(route==='paid-invoice-credit-lookup'?input:input.reference);
    const {recoveryEpoch,operationId,invoiceCreditId,unapplicationId}=reference;
    if(route==='paid-invoice-credit-lookup'){
     const value=await database('SELECT crest_commands.lookup_fictional_paired_invoice_credit('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid) AS result',
      [...args,recoveryEpoch,operationId,invoiceCreditId,unapplicationId],signal);
     const result=parsePairedInvoiceCreditResolution(value,businessId,reference);
     return privateJsonResponse(value as object,result.state==='conflict'?409:200);
    }
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_fictional_paired_invoice_credit('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::text) AS result',
      [...args,input.reviewEpoch,operationId,recoveryEpoch,invoiceCreditId,unapplicationId,input.reason]);
     const parsed=parsePairedInvoiceCreditResolution(value,businessId,reference);
     check(parsed.state!=='absent'&&(parsed.state!=='retired'||parsed.receipt.reviewEpoch===input.reviewEpoch));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='paid-invoice-credit-submit'){
    const request=parsePairedInvoiceCreditInput(input),{credit,release,reviewedArCents}=request;
    const {recoveryEpoch,operationId,invoiceCreditId}=credit.reference;
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.credit_fictional_paid_invoice_line('+authority+
      ',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::date,$15::bigint,$16::bigint,$17::uuid,$18::uuid,$19::uuid,$20::bigint,$21::bigint,$22::uuid,$23::bigint,$24::text) AS result',
     [...args,recoveryEpoch,operationId,invoiceCreditId,credit.invoiceItemId,credit.customerId,credit.effectiveOn,
      credit.firstCent,credit.lastCent,credit.returnsMappingId,release.reference.unapplicationId,release.allocationId,
      release.firstCent,release.lastCent,release.fundsMappingId,reviewedArCents,credit.reason]);
     const parsed=parsePairedInvoiceCreditResult(value,businessId,request);
     check(parsed.state==='conflict'||parsed.state==='committed');
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='invoice-credit-options'){
    const {customerId,invoiceId,effectiveOn}=input;
    check(customerUuid(customerId)&&customerUuid(invoiceId)&&(effectiveOn===null||customerDate(effectiveOn)));
    const value=await database('SELECT crest_commands.read_fictional_invoice_credit_options('+authority+',$9::uuid,$10::uuid,$11::date) AS result',
     [...args,customerId,invoiceId,effectiveOn],signal);
    parseInvoiceCreditOptions(value,businessId,customerId,invoiceId,effectiveOn);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-credit-lookup'){
    const reference=parseInvoiceCreditReference(input);
    const value=await database('SELECT crest_commands.lookup_fictional_invoice_credit('+authority+',$9::uuid,$10::uuid,$11::uuid) AS result',
     [...args,reference.recoveryEpoch,reference.operationId,reference.invoiceCreditId],signal);
    const result=parseInvoiceCreditResult(value,businessId,reference);
    return privateJsonResponse(value as object,result.state==='conflict'?409:200);
   }
   if(route==='invoice-credit-retire'){
    const reference=parseInvoiceCreditReference(input.reference);
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_fictional_invoice_credit('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::text) AS result',
      [...args,input.reviewEpoch,reference.operationId,reference.recoveryEpoch,reference.invoiceCreditId,input.reason]);
     const parsed=parseInvoiceCreditResult(value,businessId,reference);
     check(parsed.state!=='absent'&&(parsed.state!=='retired'||parsed.receipt.reviewEpoch===input.reviewEpoch));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='invoice-credit-submit'){
    const credit=parseInvoiceCreditInput(input),reference=credit.reference;
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.credit_fictional_open_invoice_line('+authority
      +',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::date,$15::bigint,$16::bigint,$17::uuid,$18::text) AS result',
      [...args,reference.recoveryEpoch,reference.operationId,reference.invoiceCreditId,credit.invoiceItemId,credit.customerId,
       credit.effectiveOn,credit.firstCent,credit.lastCent,credit.returnsMappingId,credit.reason]);
     const parsed=parseInvoiceCreditResult(value,businessId,reference);
     check(parsed.state==='conflict'||parsed.state==='committed'&&invoiceCreditMatchesInput(parsed,credit));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='held-tip-options'){
    const {customerId,jurisdiction,effectiveOn}=input;
    check(customerUuid(customerId)&&(jurisdiction===null||financeAccountReviewReason(jurisdiction)&&[...jurisdiction].length<=200)
     &&(effectiveOn===null||customerDate(effectiveOn)));
    const value=await database('SELECT crest_commands.read_fictional_held_tip_options('+authority+',$9::uuid,$10::text,$11::date) AS result',
     [...args,customerId,jurisdiction,effectiveOn],signal);
    parseHeldTipOptions(value,businessId,customerId,jurisdiction,effectiveOn);
    return privateJsonResponse(value as object);
   }
   if(route==='held-tip-lookup'){
    const reference=parseHeldTipReference(input);
    const value=await database('SELECT crest_commands.lookup_fictional_held_tip('+authority+',$9::uuid,$10::uuid,$11::uuid) AS result',
     [...args,reference.recoveryEpoch,reference.operationId,reference.tipRealizationId],signal);
    const result=parseHeldTipResult(value,businessId,reference);
    return privateJsonResponse(value as object,result.state==='conflict'?409:200);
   }
   if(route==='held-tip-retire'){
    const reference=parseHeldTipReference(input.reference);
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_fictional_held_tip('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::text) AS result',
      [...args,input.reviewEpoch,reference.operationId,reference.recoveryEpoch,reference.tipRealizationId,input.reason]);
     const parsed=parseHeldTipResult(value,businessId,reference);
     check(parsed.state!=='absent'&&(parsed.state!=='retired'||parsed.receipt.reviewEpoch===input.reviewEpoch));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='held-tip-submit'){
    const tip=parseHeldTipInput(input),reference=tip.reference;
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.realize_fictional_held_tip('+authority
      +',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::date,$15::bigint,$16::bigint,$17::text,$18::uuid,$19::uuid,$20::uuid,$21::text,$22::text) AS result',
      [...args,reference.recoveryEpoch,reference.operationId,reference.tipRealizationId,tip.fundLotId,tip.customerId,
       tip.effectiveOn,tip.firstCent,tip.lastCent,tip.jurisdiction,tip.taxProfileId,tip.revenueMappingId,tip.taxMappingId,tip.customerIntentEvidence,tip.reason]);
     const parsed=parseHeldTipResult(value,businessId,reference);
     check(parsed.state==='conflict'||parsed.state==='committed'&&heldTipMatchesInput(parsed,tip));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='fund-application-options'){
    check(customerUuid(input.customerId)&&customerUuid(input.invoiceId)&&(input.effectiveOn===null||customerDate(input.effectiveOn)));
    const value=await database('SELECT crest_commands.read_fictional_customer_funds_application_options('+authority+',$9::uuid,$10::uuid,$11::date) AS result',
     [...args,input.customerId,input.invoiceId,input.effectiveOn],signal);
    parseFundApplicationOptions(value,businessId,input.customerId,input.invoiceId,input.effectiveOn);
    return privateJsonResponse(value as object);
   }
   if(route==='fund-application-lookup'){
    const reference=parseFundApplicationReference(input);
    const value=await database('SELECT crest_commands.lookup_fictional_customer_fund_application('+authority+',$9::uuid,$10::uuid,$11::uuid) AS result',
     [...args,reference.recoveryEpoch,reference.operationId,reference.fundApplicationId],signal);
    const result=parseFundApplicationResult(value,businessId,reference);
    return privateJsonResponse(value as object,result.state==='conflict'?409:200);
   }
   if(route==='fund-application-retire'){
    const reference=parseFundApplicationReference(input.reference);
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_fictional_customer_fund_application('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::text) AS result',
      [...args,input.reviewEpoch,reference.operationId,reference.recoveryEpoch,reference.fundApplicationId,input.reason]);
     const parsed=parseFundApplicationResult(value,businessId,reference);
     check(parsed.state!=='absent');
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='fund-application-submit'){
    const application=parseFundApplicationInput(input),reference=application.reference;
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.apply_fictional_customer_funds('+authority
      +',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::uuid,$15::date,$16::bigint,$17::bigint,$18::text) AS result',
      [...args,reference.recoveryEpoch,reference.operationId,reference.fundApplicationId,application.fundLotId,application.receivableId,
       application.customerId,application.effectiveOn,application.firstCent,application.lastCent,application.reason]);
     const parsed=parseFundApplicationResult(value,businessId,reference);
     check(parsed.state==='conflict'||parsed.state==='committed'&&fundApplicationMatchesInput(parsed,application));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='payment-correction-list'){
    check(customerUuid(input.customerId)&&customerUuid(input.invoiceId));
    const value=await database('SELECT crest_commands.list_fictional_invoice_payment_allocations('+authority+',$9::uuid,$10::uuid) AS result',
     [...args,input.customerId,input.invoiceId],signal);
    parseInvoicePaymentAllocations(value,businessId,input.customerId,input.invoiceId);
    return privateJsonResponse(value as object);
   }
   if(route==='payment-correction-options'){
    check(customerUuid(input.customerId)&&customerUuid(input.allocationId)&&(input.effectiveOn===null||customerDate(input.effectiveOn)));
    const value=await database('SELECT crest_commands.read_fictional_allocation_unapplication_options('+authority+',$9::uuid,$10::uuid,$11::date) AS result',
     [...args,input.customerId,input.allocationId,input.effectiveOn],signal);
    parseAllocationUnapplicationOptions(value,businessId,input.customerId,input.allocationId,input.effectiveOn);
    return privateJsonResponse(value as object);
   }
   if(route==='payment-correction-lookup'){
    const reference=parseAllocationUnapplicationReference(input);
    const value=await database('SELECT crest_commands.lookup_fictional_allocation_unapplication('+authority+',$9::uuid,$10::uuid,$11::uuid) AS result',
     [...args,reference.recoveryEpoch,reference.operationId,reference.unapplicationId],signal);
    const result=parseAllocationUnapplicationResult(value,businessId,reference);
    return privateJsonResponse(value as object,result.state==='conflict'?409:200);
   }
   if(route==='payment-correction-retire'){
    const reference=parseAllocationUnapplicationReference(input.reference);
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_fictional_allocation_unapplication('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::text) AS result',
      [...args,input.reviewEpoch,reference.operationId,reference.recoveryEpoch,reference.unapplicationId,input.reason]);
     const parsed=parseAllocationUnapplicationResult(value,businessId,reference);
     check(parsed.state!=='absent');
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='payment-correction-submit'){
    const correction=parseAllocationUnapplicationInput(input),reference=correction.reference;
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.unapply_fictional_payment_allocation('+authority
      +',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::uuid,$15::date,$16::bigint,$17::bigint,$18::text) AS result',
      [...args,reference.recoveryEpoch,reference.operationId,reference.unapplicationId,correction.allocationId,correction.customerId,
       correction.fundsMappingId,correction.effectiveOn,correction.firstCent,correction.lastCent,correction.reason]);
     const parsed=parseAllocationUnapplicationResult(value,businessId,reference);
     check(parsed.state==='conflict'||parsed.state==='committed'&&allocationUnapplicationMatchesInput(parsed,correction));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='receivable-aging'){
    check(input.throughOn===null||customerDate(input.throughOn));
    const value=await database('SELECT crest_commands.read_fictional_receivable_aging('+authority+',$9::date) AS result',
     [...args,input.throughOn],signal);
    parseReceivableAging(value,businessId,input.throughOn);
    return privateJsonResponse(value as object);
   }
   if(route==='trial-balance'){
    check(input.throughOn===null||customerDate(input.throughOn));
    const command=serviceRefunds?'read_fictional_trial_balance_v6':invoiceCredits?'read_fictional_trial_balance_v5':heldTips?'read_fictional_trial_balance_v4':fundApplications?'read_fictional_trial_balance_v3'
     :paymentCorrections?'read_fictional_trial_balance_v2':'read_fictional_trial_balance';
    const value=await database('SELECT crest_commands.'+command+'('+authority+',$9::date) AS result',
     [...args,input.throughOn],signal);
    if(serviceRefunds)parseFictionalTrialBalanceV6(value,businessId,input.throughOn);
    else if(invoiceCredits)parseFictionalTrialBalanceV5(value,businessId,input.throughOn);
    else if(heldTips)parseFictionalTrialBalanceV4(value,businessId,input.throughOn);
    else if(fundApplications)parseFictionalTrialBalanceV3(value,businessId,input.throughOn);
    else if(paymentCorrections)parseFictionalTrialBalanceV2(value,businessId,input.throughOn);
    else parseFictionalTrialBalance(value,businessId,input.throughOn);
    return privateJsonResponse(value as object);
   }
   if(route==='posted-journal'){
    const {throughOn,accountId,afterLineId}=input;
    check(customerDate(throughOn)&&(accountId===null||customerUuid(accountId))&&(afterLineId===null||customerUuid(afterLineId)));
    const command=serviceRefunds?'read_fictional_journal_v6':invoiceCredits?'read_fictional_journal_v5':heldTips?'read_fictional_journal_v4':fundApplications?'read_fictional_journal_v3'
     :paymentCorrections?'read_fictional_journal_v2':'read_fictional_journal';
    const pageSize=serviceRefunds?fictionalJournalV6PageSize:invoiceCredits?fictionalJournalV5PageSize:heldTips?fictionalJournalV4PageSize:fundApplications?fictionalJournalV3PageSize
     :paymentCorrections?fictionalJournalV2PageSize:fictionalJournalPageSize;
    const value=await database('SELECT crest_commands.'+command+'('+authority+',$9::date,$10::uuid,$11::uuid,$12::integer) AS result',
     [...args,throughOn,accountId,afterLineId,pageSize],signal);
    if(serviceRefunds)parseFictionalJournalV6(value,businessId,throughOn,accountId,afterLineId);
    else if(invoiceCredits)parseFictionalJournalV5(value,businessId,throughOn,accountId,afterLineId);
    else if(heldTips)parseFictionalJournalV4(value,businessId,throughOn,accountId,afterLineId);
    else if(fundApplications)parseFictionalJournalV3(value,businessId,throughOn,accountId,afterLineId);
    else if(paymentCorrections)parseFictionalJournalV2(value,businessId,throughOn,accountId,afterLineId);
    else parseFictionalJournal(value,businessId,throughOn,accountId,afterLineId);
    return privateJsonResponse(value as object);
   }
   if(route==='expense-post-options'){
    check(customerUuid(input.expenseId));
    const value=await database('SELECT crest_commands.read_fictional_same_day_expense_options('+authority+',$9::uuid) AS result',
     [...args,input.expenseId],signal);
    parseSameDayExpenseOptions(value,businessId,input.expenseId);
    return privateJsonResponse(value as object);
   }
   if(route==='expense-post-lookup'){
    const reference=parseSameDayExpenseReference(input);
    const value=await database('SELECT crest_commands.lookup_fictional_same_day_expense('+authority+',$9::uuid,$10::uuid,$11::uuid) AS result',
     [...args,reference.recoveryEpoch,reference.operationId,reference.postedExpenseId],signal);
    parseSameDayExpenseResult(value,businessId,reference);
    return privateJsonResponse(value as object);
   }
   if(route==='expense-post-retire'){
    const reference=parseSameDayExpenseReference(input.reference);
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_fictional_same_day_expense('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::text) AS result',
      [...args,input.reviewEpoch,reference.operationId,reference.recoveryEpoch,reference.postedExpenseId,input.reason]);
     const parsed=parseSameDayExpenseResult(value,businessId,reference);
     check(parsed.state!=='absent'&&(parsed.state!=='retired'||parsed.receipt.reviewEpoch===input.reviewEpoch));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='expense-post-submit'){
    const expense=parseSameDayExpenseInput(input),{reference}=expense;
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.post_fictional_same_day_expense('+authority+
      ',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::bigint,$14::uuid,$15::bigint,$16::uuid,$17::date,$18::date,$19::text,$20::bigint,$21::uuid,$22::text,$23::text,$24::text,$25::jsonb) AS result',
     [...args,reference.recoveryEpoch,reference.operationId,reference.postedExpenseId,expense.expenseId,expense.expenseRevision,
      expense.channelId,expense.channelVersion,expense.mappingId,expense.incurredOn,expense.paidOn,expense.purchaseTaxTreatment,
      expense.purchaseTaxCents,expense.receiptId,expense.missingReceiptReason,expense.unknownVendorReason,expense.reviewReason,expense.externalIdentity]);
     const parsed=parseSameDayExpenseResult(value,businessId,reference);
     check(parsed.state==='conflict'||parsed.state==='retired'||parsed.state==='committed'&&sameDayExpenseMatchesInput(parsed,expense));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='receipt-options'){
    check(customerUuid(input.customerId)&&(input.actualOn===null||customerDate(input.actualOn)));
    const value=await database('SELECT crest_commands.read_direct_fictional_receipt_options('+authority+',$9::uuid,$10::date) AS result',
     [...args,input.customerId,input.actualOn],signal);
    parseDirectReceiptOptions(value,businessId,input.customerId,input.actualOn);
    return privateJsonResponse(value as object);
   }
   if(route==='receipt-lookup'){
    const reference=parseDirectReceiptReference(input);
    const value=await database('SELECT crest_commands.lookup_direct_fictional_receipt('+authority+',$9::uuid,$10::uuid,$11::uuid) AS result',
     [...args,reference.recoveryEpoch,reference.operationId,reference.paymentId],signal);
    parseDirectReceiptResult(value,businessId,reference);
    return privateJsonResponse(value as object);
   }
   if(route==='receipt-retire'){
    const reference=parseDirectReceiptReference(input.reference);
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_direct_fictional_receipt('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::text) AS result',
      [...args,input.reviewEpoch,reference.operationId,reference.recoveryEpoch,reference.paymentId,input.reason]);
     const parsed=parseDirectReceiptResult(value,businessId,reference);
     check(parsed.state!=='absent'&&(parsed.state!=='retired'||parsed.receipt.reviewEpoch===input.reviewEpoch));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='receipt-record'){
    const receipt=parseDirectReceiptInput(input),reference=receipt.reference;
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.record_direct_fictional_receipt('+authority
      +',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::bigint,$15::date,$16::bigint,$17::text,$18::text,$19::jsonb,$20::jsonb) AS result',
      [...args,reference.recoveryEpoch,reference.operationId,reference.paymentId,receipt.customerId,receipt.channelId,
       receipt.channelVersion,receipt.actualOn,receipt.grossCents,receipt.confirmation,receipt.distinctReason,receipt.externalIdentity,receipt.applications]);
     const parsed=parseDirectReceiptResult(value,businessId,reference);
     check(parsed.state==='conflict'||parsed.state==='committed'&&directReceiptMatchesInput(parsed,receipt));
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='invoice-setup-read'){
    check(input.requestedOn===null||customerDate(input.requestedOn));
    const value=await database('SELECT crest_commands.read_fictional_invoice_setup('+authority+',$9::date) AS result',
     [...args,input.requestedOn],signal);
    parseInvoiceSetupRead(value,businessId,input.requestedOn);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-setup-save'){
    const write=parseInvoiceSetupWrite(input);
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.configure_fictional_invoice_setup('+authority+',$9::uuid,$10::uuid,$11::jsonb) AS result',
      [...args,write.recoveryEpoch,write.operationId,write.request]);
     const parsed=parseInvoiceSetupResult(value,businessId,write);
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='invoice-preparation'){
    check(customerUuid(input.jobId));
    const value=await database('SELECT crest_commands.read_invoice_preparation('+authority+',$9::uuid) AS result',
     [...args,input.jobId],signal);
    parseInvoicePreparation(value,businessId,input.jobId);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-issue-tax-review'){
    const review=parseInvoiceIssueTaxRequest(input);
    const value=await database('SELECT crest_commands.review_invoice_issue_accounts('+authority+',$9::uuid,$10::bigint,$11::jsonb) AS result',
     [...args,review.draftId,review.revision,review.jurisdictions],signal);
    parseInvoiceIssueReadiness(value,businessId,review);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-issue-prepare'){
    const review=parseInvoiceIssueTaxRequest(input);
    const value=await database('SELECT crest_commands.prepare_reviewed_invoice_issue('+authority+',$9::uuid,$10::bigint,$11::jsonb) AS result',
     [...args,review.draftId,review.revision,review.jurisdictions],signal);
    parseReviewedInvoiceIssue(value,businessId,review);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-issue-read'){
    check(customerUuid(input.draftId));
    const value=await database('SELECT crest_commands.read_issued_invoice('+authority+',$9::uuid) AS result',[...args,input.draftId],signal);
    parseIssuedInvoice(value,businessId,input.draftId);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-issue-tax-mapping-read'){
    check(invoiceTaxJurisdiction(input.jurisdiction));
    const value=await database('SELECT crest_commands.read_invoice_tax_payable_mapping('+authority+',$9::text) AS result',
     [...args,input.jurisdiction],signal);
    parseInvoiceTaxMappingEditor(value,businessId,input.jurisdiction);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-issue-tax-mapping-lookup'){
    const ref=parseInvoiceTaxMappingReference(input);
    const value=await database('SELECT crest_commands.lookup_invoice_tax_payable_mapping_approval('+authority
     +',$9::uuid,$10::uuid,$11::text,$12::bigint) AS result',
     [...args,ref.operationId,ref.recoveryEpoch,ref.jurisdiction,ref.expectedVersion],signal);
    parseInvoiceTaxMappingResult(value,businessId,ref);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-issue-tax-mapping-approve'){
    const approval=parseInvoiceTaxMappingApproval(input.approval);
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.approve_invoice_tax_payable_mapping('+authority
      +',$9::uuid,$10::uuid,$11::text,$12::bigint,$13::uuid,$14::date,$15::text) AS result',
      [...args,approval.recoveryEpoch,approval.operationId,approval.jurisdiction,approval.expectedVersion,approval.accountId,
       approval.effectiveFrom,approval.reason]);
     const parsed=parseInvoiceTaxMappingResult(value,businessId,approval,approval);
     check(parsed.state!=='absent');
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='invoice-issue-exemption-read'){
    const target=parseInvoiceExemptionTarget(input);
    const value=await database('SELECT crest_commands.read_invoice_exemption_evidence('+authority
     +',$9::uuid,$10::bigint,$11::uuid,$12::text,$13::uuid) AS result',
     [...args,target.draftId,target.draftRevision,target.outcomeId,target.jurisdiction,target.profileId],signal);
    parseInvoiceExemptionEditor(value,businessId,target);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-issue-exemption-approve'){
    const approval=parseInvoiceExemptionApproval(input.approval),target=approval.target;
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.approve_invoice_exemption_evidence('+authority
      +',$9::uuid,$10::uuid,$11::uuid,$12::bigint,$13::uuid,$14::text,$15::uuid,$16::bigint,$17::date,$18::date,$19::text,$20::text) AS result',
      [...args,approval.recoveryEpoch,approval.operationId,target.draftId,target.draftRevision,target.outcomeId,target.jurisdiction,
       target.profileId,approval.expectedVersion,approval.validFrom,approval.validThrough,approval.evidenceReference,approval.reason]);
     const parsed=parseInvoiceExemptionResult(value,businessId,approval);
     return {value:value as object,state:parsed.state};
    },signal);
    return privateJsonResponse(result.value,result.state==='conflict'?409:200);
   }
   if(route==='invoice-issue-lookup'||route==='invoice-issue-submit'||route==='invoice-issue-retire'){
    if(route==='invoice-issue-lookup'){
     const ref=parseInvoiceIssueReference(input);
     const value=await database('SELECT crest_commands.lookup_invoice_issue('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::bigint) AS result',
      [...args,ref.recoveryEpoch,ref.operationId,ref.draftId,ref.revision],signal);
     return privateJsonResponse(parseInvoiceIssueResult(value,businessId,ref));
    }
    if(route==='invoice-issue-retire'){
     const ref=parseInvoiceIssueReference(input.reference);
     check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
     const result=await database.commandTransaction(async query=>{
      submitted=true;
      const value=await query('SELECT crest_commands.retire_invoice_issue('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::bigint,$14::text) AS result',
       [...args,input.reviewEpoch,ref.operationId,ref.recoveryEpoch,ref.draftId,ref.revision,input.reason]);
      const parsed=parseInvoiceIssueResult(value,businessId,ref);
      check(parsed.state!=='absent'&&(parsed.state!=='retired'||parsed.receipt.reviewEpoch===input.reviewEpoch));
      return parsed;
     },signal);
     return privateJsonResponse(result,result.state==='conflict'?409:200);
    }
    const {reference:ref,jurisdictions,reviewDigest}=parseInvoiceIssueRequest(input);
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.issue_reviewed_invoice('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::bigint,$13::jsonb,$14::text) AS result',
      [...args,ref.recoveryEpoch,ref.operationId,ref.draftId,ref.revision,jurisdictions,reviewDigest]);
     const parsed=parseInvoiceIssueResult(value,businessId,ref);
     check(parsed.state!=='absent');
     return parsed;
    },signal);
    return privateJsonResponse(result,result.state==='conflict'?409:200);
   }
   if(route==='invoice-draft-list'){
    check(customerUuid(input.jobId)&&(input.afterDraft===null||customerUuid(input.afterDraft)));
    const value=await database('SELECT crest_commands.list_invoice_drafts('+authority+',$9::uuid,$10::uuid) AS result',
     [...args,input.jobId,input.afterDraft],signal);
    parseInvoiceDraftPage(value,businessId,input.jobId,input.afterDraft);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-draft-read'){
    check(customerUuid(input.draftId)&&(input.revision===null||customerVersion(input.revision)));
    const value=await database('SELECT crest_commands.read_invoice_draft('+authority+',$9::uuid,$10::bigint) AS result',
     [...args,input.draftId,input.revision],signal);
    parseInvoiceDraftRead(value,input.draftId,input.revision);
    return privateJsonResponse(value as object);
   }
   if(route==='invoice-draft-lookup'||route==='invoice-draft-save'||route==='invoice-draft-retire'){
    const ref=parseInvoiceDraftReference(route==='invoice-draft-lookup'?input:input.reference);
    if(route==='invoice-draft-lookup'){
     const value=await database('SELECT crest_commands.lookup_invoice_draft_operation('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::bigint,$13::uuid) AS result',
      [...args,ref.operationId,ref.recoveryEpoch,ref.draftId,ref.expectedRevision,ref.jobId],signal);
     return privateJsonResponse(parseInvoiceDraftOperation(value,ref));
    }
    if(route==='invoice-draft-retire'){
     check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
     const decision=await database.commandTransaction(async query=>{
      submitted=true;
      const value=await query('SELECT crest_commands.retire_invoice_draft_operation('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::bigint,$14::uuid,$15::text) AS result',
       [...args,input.reviewEpoch,ref.operationId,ref.recoveryEpoch,ref.draftId,ref.expectedRevision,ref.jobId,input.reason]);
      const parsed=parseInvoiceDraftOperation(value,ref);
      check(parsed.state==='committed'||parsed.state==='retired'||parsed.state==='conflict'&&parsed.reason==='operation');
      return value as object;
     },signal);
     const result=parseInvoiceDraftOperation(decision,ref);
     return privateJsonResponse(decision,result.state==='conflict'?409:200);
    }
    const draft=parseInvoiceDraftInput(input.draft,ref);
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.save_invoice_draft('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::bigint,$13::uuid,$14::date,$15::uuid[],$16::text) AS result',
      [...args,ref.recoveryEpoch,ref.operationId,ref.draftId,ref.expectedRevision,ref.jobId,draft.dueOn,draft.outcomes,draft.cancelReason]);
     const parsed=parseInvoiceDraftOperation(value,ref);
     check(parsed.state==='committed'||parsed.state==='conflict');
     if(parsed.state==='committed'){
      const saved=parsed.receipt;
      check(draft.cancelReason===null?saved.state==='draft'&&saved.dueOn===draft.dueOn&&saved.lineCount===draft.outcomes.length
       :saved.state==='cancelled'&&saved.reason===draft.cancelReason);
     }
     return parsed;
    },signal);
    return privateJsonResponse(result,result.state==='conflict'?409:200);
   }
   if(route==='channel-list'){
    check(input.afterChannel===null||customerUuid(input.afterChannel));
    const value=await database('SELECT crest_commands.read_money_channels('+authority+',$9::uuid,25) AS result',
     [...args,input.afterChannel],signal);
    parseMoneyChannelPage(value,businessId,input.afterChannel);
    return privateJsonResponse(value as object);
   }
   if(route==='channel-history'){
    check(customerUuid(input.channelId)&&(input.beforeVersion===null||customerVersion(input.beforeVersion)));
    const value=await database('SELECT crest_commands.read_money_channel_history('+authority+',$9::uuid,$10::bigint,25) AS result',
     [...args,input.channelId,input.beforeVersion],signal);
    parseMoneyChannelHistory(value,businessId,input.channelId,input.beforeVersion);
    return privateJsonResponse(value as object);
   }
   if(route==='channel-accounts'){
    check(moneyChannelKind(input.kind)&&moneyChannelScope(input.kind,input.ownershipScope)
     &&(input.afterCode===null||financeAccountCode(input.afterCode)));
    const value=await database('SELECT crest_commands.list_money_channel_accounts('+authority+',$9::text,$10::text,$11::text,25) AS result',
     [...args,input.kind,input.ownershipScope,input.afterCode],signal);
    parseMoneyChannelAccounts(value,businessId,input.kind,input.ownershipScope);
    return privateJsonResponse(value as object);
   }
   if(route==='channel-lookup'||route==='channel-save'||route==='channel-retire'){
    const reference=parseMoneyChannelReference(route==='channel-lookup'?input:input.reference);
    const original=[reference.operationId,reference.recoveryEpoch,reference.channelId,reference.expectedVersion];
    if(route==='channel-lookup'){
     const value=await database('SELECT crest_commands.lookup_money_channel_operation('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::bigint) AS result',
      [...args,...original],signal);
     parseMoneyChannelOperation(value,businessId,reference);
     return privateJsonResponse(value as object);
    }
    if(route==='channel-retire'){
     check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
     const result=await database.commandTransaction(async query=>{
      submitted=true;
      const value=await query('SELECT crest_commands.retire_money_channel_operation('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::bigint,$14::text) AS result',
       [...args,input.reviewEpoch,...original,input.reason]);
      const outcome=parseMoneyChannelOperation(value,businessId,reference);
      check(outcome.state!=='absent'&&(outcome.state!=='retired'||outcome.reviewEpoch===input.reviewEpoch));
      return {value:value as object,status:outcome.state==='conflict'?409:200};
     },signal);
     return privateJsonResponse(result.value,result.status);
    }
    const draft=parseMoneyChannelDraft(input.draft,reference.expectedVersion);
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.save_money_channel('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::bigint,$13::jsonb) AS result',
      [...args,reference.recoveryEpoch,reference.operationId,reference.channelId,reference.expectedVersion,draft]);
     const outcome=parseMoneyChannelOperation(value,businessId,reference);
     check(outcome.state==='conflict'||outcome.state==='committed'&&moneyChannelReceiptMatches(outcome.receipt,draft));
     return {value:value as object,status:outcome.state==='conflict'?409:200};
    },signal);
    return privateJsonResponse(result.value,result.status);
   }
   if(route==='tax-history'){
    const scope=parseFinanceTaxScope({jurisdiction:input.jurisdiction,applicability:input.applicability,serviceId:input.serviceId});
    check(input.beforeVersion===null||customerVersion(input.beforeVersion));
    const value=await database('SELECT crest_commands.read_finance_tax_profile_history('+authority+',$9::text,$10::text,$11::uuid,$12::bigint,25) AS result',
     [...args,scope.jurisdiction,scope.applicability,scope.serviceId,input.beforeVersion],signal);
    parseFinanceTaxHistory(value,businessId,scope,input.beforeVersion);
    return privateJsonResponse(value as object);
   }
   if(route==='tax-preview'){
    const scope=parseFinanceTaxScope({jurisdiction:input.jurisdiction,applicability:input.applicability,serviceId:input.serviceId});
    check(customerDate(input.date)&&financeTaxCents(input.grossCents)&&financeTaxCents(input.discountCents)
     &&BigInt(input.discountCents)<=BigInt(input.grossCents));
    const value=await database('SELECT crest_commands.preview_finance_tax_charge('+authority+',$9::text,$10::text,$11::uuid,$12::date,$13::bigint,$14::bigint) AS result',
     [...args,scope.jurisdiction,scope.applicability,scope.serviceId,input.date,input.grossCents,input.discountCents],signal);
    parseFinanceTaxPreview(value,businessId,scope,input.date,input.grossCents,input.discountCents);
    return privateJsonResponse(value as object);
   }
   if(route==='tax-operation'||route==='tax-approve'||route==='tax-retire'){
    const reference=parseFinanceTaxReference(route==='tax-operation'?input:input.reference);
    const original=[reference.operationId,reference.recoveryEpoch,reference.expectedVersion];
    if(route==='tax-operation'){
     const value=await database('SELECT crest_commands.lookup_finance_tax_profile_approval('+authority+',$9::uuid,$10::uuid,$11::bigint) AS result',
      [...args,...original],signal);
     const outcome=parseFinanceTaxOperation(value,businessId,reference);
     check(outcome.state!=='committed'||outcome.receipt.reviewedBy===verified.actorId);
     return privateJsonResponse(value as object);
    }
    if(route==='tax-retire'){
     check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
     const result=await database.commandTransaction(async query=>{
      submitted=true;
      const value=await query('SELECT crest_commands.retire_finance_tax_profile_approval('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::bigint,$13::text) AS result',
       [...args,input.reviewEpoch,...original,input.reason]);
      const outcome=parseFinanceTaxOperation(value,businessId,reference);
      check(outcome.state!=='absent'&&(outcome.state!=='retired'||outcome.receipt.reviewEpoch===input.reviewEpoch)
       &&(outcome.state!=='committed'||outcome.receipt.reviewedBy===verified.actorId));
      return {value:value as object,status:outcome.state==='conflict'?409:200};
     },signal);
     return privateJsonResponse(result.value,result.status);
    }
    const approval=parseFinanceTaxApproval(input.approval);
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.approve_finance_tax_profile('+authority+',$9::uuid,$10::uuid,$11::text,$12::text,$13::uuid,$14::bigint,$15::date,$16::text,$17::numeric,$18::text,$19::text) AS result',
      [...args,reference.recoveryEpoch,reference.operationId,approval.jurisdiction,approval.applicability,approval.serviceId,
       reference.expectedVersion,approval.effectiveFrom,approval.treatment,approval.rate,approval.verificationEvidence,approval.reason]);
     const outcome=parseFinanceTaxOperation(value,businessId,reference);
     check(outcome.state==='conflict'||outcome.state==='committed'&&outcome.receipt.reviewedBy===verified.actorId
      &&matchesFinanceTaxApproval(outcome.receipt,approval));
     return {value:value as object,status:outcome.state==='conflict'?409:200};
    },signal);
    return privateJsonResponse(result.value,result.status);
   }
   if(route==='mapping-category-accounts'){
    check(categoryMappings&&expenseCategoryMappingPurpose(input.purpose)
     &&(input.afterCode===null||financeAccountCode(input.afterCode)));
    const value=await database('SELECT crest_commands.list_expense_category_mapping_accounts('+authority+',$9::text,$10::text,25) AS result',
     [...args,input.purpose,input.afterCode],signal);
    parseExpenseCategoryMappingAccounts(value,businessId,input.purpose);
    return privateJsonResponse(value as object);
   }
   if(route==='mapping-at'){
    check(mappingPurpose(input.purpose)&&customerDate(input.date));
    const value=await database('SELECT crest_commands.resolve_fixed_finance_mapping('+authority+',$9::text,$10::date) AS result',
     [...args,input.purpose,input.date],signal);
    check(parseFinanceMappingAt(value,input.purpose,input.date));
    return privateJsonResponse(value as object);
   }
   if(route==='mapping-history'){
    check(mappingPurpose(input.purpose)&&(input.beforeVersion===null||customerVersion(input.beforeVersion)));
    const value=await database('SELECT crest_commands.read_fixed_finance_mapping_history('+authority+',$9::text,$10::bigint,25) AS result',
     [...args,input.purpose,input.beforeVersion],signal);
    parseFinanceMappingHistory(value,businessId,input.purpose,input.beforeVersion);
    return privateJsonResponse(value as object);
   }
   if(route==='mapping-editor'){
    check(fixedFinanceMappingPurpose(input.purpose));
    const value=await database('SELECT crest_commands.fixed_finance_mapping_editor('+authority+',$9::text) AS result',
     [...args,input.purpose],signal);
    parseFinanceMappingEditor(value,businessId,input.purpose);
    return privateJsonResponse(value as object);
   }
   if(route==='mapping-operation'||route==='mapping-approve'||route==='mapping-retire'){
    const reference=parseFinanceMappingReference(route==='mapping-operation'?input:input.reference);
    check(mappingPurpose(reference.purpose));
    const original=[reference.operationId,reference.recoveryEpoch,reference.purpose,reference.expectedVersion];
    if(route==='mapping-operation'){
     const value=await database('SELECT crest_commands.lookup_fixed_finance_mapping_operation('+authority+',$9::uuid,$10::uuid,$11::text,$12::bigint) AS result',
      [...args,...original],signal);
     parseFinanceMappingOperation(value,businessId,reference);
     return privateJsonResponse(value as object);
    }
    if(route==='mapping-retire'){
     check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
     const result=await database.commandTransaction(async query=>{
      submitted=true;
      const value=await query('SELECT crest_commands.retire_fixed_finance_mapping_approval('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::text,$13::bigint,$14::text) AS result',
       [...args,input.reviewEpoch,...original,input.reason]);
      const outcome=parseFinanceMappingOperation(value,businessId,reference);
      check(outcome.state!=='absent'&&(outcome.state!=='retired'||outcome.reviewEpoch===input.reviewEpoch));
      return {value:value as object,status:outcome.state==='conflict'?409:200};
     },signal);
     return privateJsonResponse(result.value,result.status);
    }
    const approval=parseFinanceMappingApproval(input.approval);
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.approve_fixed_finance_mapping('+authority+',$9::uuid,$10::uuid,$11::text,$12::bigint,$13::uuid,$14::date,$15::text) AS result',
      [...args,reference.recoveryEpoch,reference.operationId,reference.purpose,reference.expectedVersion,
       approval.accountId,approval.effectiveFrom,approval.reason]);
     const outcome=parseFinanceMappingOperation(value,businessId,reference);
     check(outcome.state==='conflict'||outcome.state==='committed'&&outcome.receipt.accountId===approval.accountId
      &&outcome.receipt.effectiveFrom===approval.effectiveFrom&&outcome.receipt.reason===approval.reason);
     return {value:value as object,status:outcome.state==='conflict'?409:200};
    },signal);
    return privateJsonResponse(result.value,result.status);
   }
   if(route==='list'){
    check((input.afterCode===null||financeAccountCode(input.afterCode))&&typeof input.includeArchived==='boolean');
    const value=await database('SELECT crest_commands.list_finance_accounts('+authority+',$9::text,$10::boolean,25) AS result',
     [...args,input.afterCode,input.includeArchived],signal);
    parseFinanceAccountPage(value,businessId);
    return privateJsonResponse(value as object);
   }
   if(route==='history'){
    check(customerUuid(input.accountId)&&customerVersion(input.afterVersion,true));
    const value=await database('SELECT crest_commands.read_finance_account_history('+authority+',$9::uuid,$10::bigint,25) AS result',
     [...args,input.accountId,input.afterVersion],signal);
    parseFinanceAccountHistory(value,businessId,input.accountId,input.afterVersion);
    return privateJsonResponse(value as object);
   }
   const reference=parseFinanceAccountReference(route==='operation'?input:input.reference);
   const original=[reference.operationId,reference.recoveryEpoch,reference.accountId,reference.expectedVersion];
   if(route==='operation'){
    const value=await database('SELECT crest_commands.lookup_finance_account_operation('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::bigint) AS result',
     [...args,...original],signal);
    return privateJsonResponse(parseFinanceAccountResolution(value,businessId,reference));
   }
   if(route==='retire'){
    check(customerUuid(input.reviewEpoch)&&financeAccountReviewReason(input.reason));
    const result=await database.commandTransaction(async query=>{
     submitted=true;
     const value=await query('SELECT crest_commands.retire_finance_account_save('+authority+',$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::bigint,$14::text) AS result',
      [...args,input.reviewEpoch,...original,input.reason]);
     const decision=parseFinanceAccountResolution(value,businessId,reference);
     check(decision.state!=='absent'&&(decision.state!=='retired'||decision.receipt.reviewEpoch===input.reviewEpoch));
     return decision;
    },signal);
    return privateJsonResponse(result,result.state==='conflict'?409:200);
   }
   const draft=parseFinanceAccountDraft(input.draft,reference.expectedVersion);
   const result=await database.commandTransaction(async(query)=>{
    submitted=true;
    const value=await query('SELECT crest_commands.save_finance_account('+authority+',$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::jsonb) AS result',
     [...args,reference.recoveryEpoch,reference.operationId,reference.accountId,reference.expectedVersion,draft]);
    if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='operation'||value.reason==='account'))return value;
    if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'
     &&customerVersion(value.currentVersion,true))return value;
    return parseFinanceAccountReceipt(value,businessId,reference);
   },signal);
   return privateJsonResponse(result,result.state==='conflict'?409:200);
  }catch(error){
   if(error instanceof Error&&error.message==='FINANCE_MAPPING_NOT_READY')return privateJsonResponse({state:'unavailable'});
   if(error instanceof Error&&(invoiceCreditRefusal(error.message)||pairedInvoiceCreditRefusal(error.message)||serviceRefundRefusal(error.message)||
     error.message==='INVOICE_CREDIT_OPTIONS_LIMIT'||error.message==='SERVICE_REFUND_OPTIONS_LIMIT'))
    return privateJsonResponse({error:error.message},409);
   if(error instanceof Error&&['RECOVERY_REVIEW_REQUIRED','FINANCE_ACCOUNT_SIGN_IN_REQUIRED','FINANCE_ACCOUNT_SETUP_REQUIRED',
    'FINANCE_MAPPING_VERSION_CONFLICT','FINANCE_MAPPING_EFFECTIVE_ORDER_REQUIRED','FINANCE_MAPPING_ACCOUNT_REQUIRED',
    'FINANCE_MAPPING_CLOSURE_REQUIRED','FINANCE_TAX_VERSION_CONFLICT','FINANCE_TAX_EFFECTIVE_ORDER_REQUIRED',
    'FINANCE_CHANNEL_VERSION_CONFLICT','FINANCE_CHANNEL_EFFECTIVE_ORDER_REQUIRED','FINANCE_CHANNEL_ACCOUNT_REQUIRED',
    'FINANCE_CHANNEL_ACCOUNT_PINNED','FINANCE_CHANNEL_IDENTITY_RETAINED',
    'INVOICE_DRAFT_JOB_REQUIRED','INVOICE_DRAFT_COMPLETED_SCOPE_REQUIRED','INVOICE_ISSUE_DRAFT_REQUIRED',
    'INVOICE_ISSUE_REVIEW_REQUIRED','INVOICE_SCOPE_ALREADY_CONSUMED','ACCOUNTING_OPEN_PERIOD_REQUIRED',
    'APPROVED_INVOICE_SERIES_REQUIRED','INVOICE_TAX_MAPPING_VERSION_CONFLICT','INVOICE_TAX_MAPPING_EFFECTIVE_ORDER_REQUIRED',
    'INVOICE_TAX_MAPPING_ACCOUNT_REQUIRED','UNAPPLICATION_DATE_REQUIRED','UNAPPLICATION_ALLOCATION_REQUIRED',
    'UNAPPLICATION_RANGE_UNAVAILABLE','UNAPPLICATION_FUNDS_MAPPING_REQUIRED','UNAPPLICATION_ALREADY_RECORDED',
    'UNAPPLICATION_OPTIONS_LIMIT','FUND_APPLICATION_DATE_REQUIRED','FUND_APPLICATION_LOT_REQUIRED',
    'FUND_APPLICATION_RECEIVABLE_REQUIRED','FUND_APPLICATION_CONTROL_ACCOUNTS_REQUIRED','FUND_APPLICATION_RANGE_UNAVAILABLE',
    'FUND_APPLICATION_ALREADY_RECORDED','FUND_APPLICATION_EXCEEDS_BALANCE','FUND_APPLICATION_OPTIONS_LIMIT',
    'TIP_REALIZATION_DATE_REQUIRED','TIP_REALIZATION_INPUT_REQUIRED','TIP_REALIZATION_LOT_REQUIRED','TIP_REALIZATION_RANGE_UNAVAILABLE',
    'TIP_REALIZATION_BASIS_REQUIRED','TIP_REALIZATION_ALREADY_RECORDED','TIP_REALIZATION_OPTIONS_LIMIT',
    ...directReceiptRefusals,...sameDayExpenseRefusals].includes(error.message))
    return privateJsonResponse({error:error.message},409);
   return submitted?privateJsonResponse({error:'FINANCE_ACCOUNT_OUTCOME_UNKNOWN'},503):financeAccountFailure();
  }finally{credentialHash?.fill(0);}
 };
}
