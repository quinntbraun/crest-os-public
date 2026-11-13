import {authentication} from './authentication';
import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract';
import {
 parseFinanceAccountHistory,parseFinanceAccountPage,parseFinanceAccountReceipt,
 parseFinanceAccountReference,parseFinanceAccountResolution,financeAccountReviewReason,requireFinanceAccount as check,
} from '../bookkeeping/finance-account-contract';
import type {FinanceAccountDraft,FinanceAccountReference} from '../bookkeeping/finance-account-contract';
import {expenseCategoryMappingPurpose,parseExpenseCategoryMappingAccounts,parseFinanceMappingAt,parseFinanceMappingEditor,parseFinanceMappingHistory,parseFinanceMappingOperation,parseFinanceMappingReference} from '../bookkeeping/finance-mapping-contract';
import type {ExpenseCategoryMappingPurpose,FinanceMappingApproval,FinanceMappingPurpose,FinanceMappingReference,FixedFinanceMappingPurpose} from '../bookkeeping/finance-mapping-contract';

import {
 matchesFinanceTaxApproval,parseFinanceTaxHistory,parseFinanceTaxOperation,parseFinanceTaxPreview,parseFinanceTaxReference,
} from '../bookkeeping/finance-tax-contract';
import type {FinanceTaxApproval,FinanceTaxReference,FinanceTaxScope} from '../bookkeeping/finance-tax-contract';

import {
 moneyChannelReceiptMatches,parseMoneyChannelAccounts,parseMoneyChannelHistory,parseMoneyChannelOperation,
 parseMoneyChannelPage,parseMoneyChannelReference,
} from '../bookkeeping/finance-money-channel-contract';
import type {MoneyChannelDraft,MoneyChannelKind,MoneyChannelReference,MoneyChannelScope} from '../bookkeeping/finance-money-channel-contract';

import {parseInvoicePreparation} from '../bookkeeping/invoice-preparation-contract';
import {parseInvoiceDraftInput,parseInvoiceDraftOperation,parseInvoiceDraftPage,parseInvoiceDraftRead,parseInvoiceDraftReference} from '../bookkeeping/invoice-draft-contract';
import type {InvoiceDraftInput,InvoiceDraftReference} from '../bookkeeping/invoice-draft-contract';

import {parseInvoiceIssueReadiness,parseInvoiceIssueTaxRequest} from '../bookkeeping/invoice-issue-tax-review-contract';
import type {InvoiceIssueJurisdictions} from '../bookkeeping/invoice-issue-tax-review-contract';
import {parseInvoiceIssueReference,parseInvoiceIssueRequest,parseInvoiceIssueResult,parseIssuedInvoice,
 parseReviewedInvoiceIssue} from '../bookkeeping/issued-invoice-contract';
import {invoiceTaxJurisdiction,parseInvoiceTaxMappingApproval,parseInvoiceTaxMappingEditor,parseInvoiceTaxMappingReference,parseInvoiceTaxMappingResult}
 from '../bookkeeping/invoice-tax-payable-contract';
import {parseInvoiceExemptionApproval,parseInvoiceExemptionEditor,parseInvoiceExemptionResult,parseInvoiceExemptionTarget}
 from '../bookkeeping/invoice-exemption-contract';
import {parseInvoiceSetupRead,parseInvoiceSetupResult,parseInvoiceSetupWrite} from '../bookkeeping/invoice-setup-contract';
import {directReceiptMatchesInput,parseDirectReceiptInput,parseDirectReceiptOptions,parseDirectReceiptReference,
 parseDirectReceiptResult} from '../bookkeeping/direct-receipt-contract';
import {parseServiceRefundCredits,parseServiceRefundInput,parseServiceRefundOptions,parseServiceRefundReference,parseServiceRefundResult,
 serviceRefundMatchesInput,serviceRefundRefusal} from '../bookkeeping/service-refund-contract';
import {parseSameDayExpenseInput,parseSameDayExpenseOptions,parseSameDayExpenseReference,parseSameDayExpenseResult,
 sameDayExpenseMatchesInput} from '../bookkeeping/expenses/same-day-expense-contract';
import {parseFictionalJournal,parseFictionalTrialBalance} from '../bookkeeping/trial-balance-contract';
import {parseFictionalJournalV2,parseFictionalTrialBalanceV2} from '../bookkeeping/posted-report-v2-contract';
import {parseFictionalJournalV3,parseFictionalTrialBalanceV3} from '../bookkeeping/posted-report-v3-contract';
import {allocationUnapplicationMatchesInput,parseAllocationUnapplicationInput,parseAllocationUnapplicationOptions,
 parseAllocationUnapplicationReference,parseAllocationUnapplicationResult,parseInvoicePaymentAllocations}
 from '../bookkeeping/allocation-unapplication-contract';
import {fundApplicationMatchesInput,parseFundApplicationInput,parseFundApplicationOptions,
 parseFundApplicationReference,parseFundApplicationResult} from '../bookkeeping/fund-application-contract';
import {heldTipMatchesInput,parseHeldTipInput,parseHeldTipOptions,parseHeldTipReference,parseHeldTipResult} from '../bookkeeping/held-tip-contract';
import {invoiceCreditMatchesInput,invoiceCreditRefusal,parseInvoiceCreditInput,parseInvoiceCreditOptions,
 parseInvoiceCreditReference,parseInvoiceCreditResult} from '../bookkeeping/invoice-credit-contract';
import {pairedInvoiceCreditRefusal,parsePairedInvoiceCreditInput,parsePairedInvoiceCreditOptions,
 parsePairedInvoiceCreditReference,parsePairedInvoiceCreditResolution,parsePairedInvoiceCreditResult} from '../bookkeeping/paired-invoice-credit-contract';
import {parseFictionalJournalV4,parseFictionalTrialBalanceV4} from '../bookkeeping/posted-report-v4-contract';
import {parseFictionalJournalV5,parseFictionalTrialBalanceV5} from '../bookkeeping/posted-report-v5-contract';
import {parseFictionalJournalV6,parseFictionalTrialBalanceV6} from '../bookkeeping/posted-report-v6-contract';
import type {Proof} from './authentication';

export type FinanceAccountContext=Readonly<{businessId:string;recoveryEpoch:string|null;writeState:'ready'|'paused';binding:string;fixedMappings:boolean;taxProfiles:boolean;categoryMappings:boolean;moneyChannels:boolean;invoicePreparation:boolean;invoiceDrafts:boolean;invoiceIssueTaxReview:boolean;invoiceIssue?:boolean;directReceipts?:boolean;sameDayExpenses?:boolean;trialBalance?:boolean;paymentCorrections?:boolean;fundApplications?:boolean;heldTips?:boolean;invoiceCredits?:boolean;paidInvoiceCredits?:boolean;serviceRefunds?:boolean}>;
const bindingPattern=/^[A-Za-z0-9_-]{43}$/;
const knownFailure=['RECOVERY_REVIEW_REQUIRED','FINANCE_ACCOUNT_SIGN_IN_REQUIRED','FINANCE_ACCOUNT_SETUP_REQUIRED'] as const;
const invoiceDraftPendingKey='crest.invoice-draft.pending-reference.v1';
const invoiceIssuePendingKey='crest.invoice-issue.pending-reference.v1';
const directReceiptPendingKey='crest.direct-receipt.pending-reference.v1';
const paymentCorrectionPendingKey='crest.payment-correction.pending-reference.v1';
const fundApplicationPendingKey='crest.fund-application.pending-reference.v1';
const heldTipPendingKey='crest.held-tip.pending-reference.v1';
const invoiceCreditPendingKey='crest.invoice-credit.pending-reference.v1';
const paidInvoiceCreditPendingKey='crest.paid-invoice-credit.pending-reference.v1';
const sameDayExpensePendingKey='crest.expense-post.pending-reference.v1';
const invoiceDraftFailure=[...knownFailure,'INVOICE_DRAFT_JOB_REQUIRED','INVOICE_DRAFT_COMPLETED_SCOPE_REQUIRED'] as const;
const pendingKey='crest.finance-account.pending-reference.v1';
type Pending=Readonly<{businessId:string;binding:string;reference:FinanceAccountReference}>;
const mappingPendingKey='crest.finance-mapping.pending-reference.v1';
type MappingPending=Readonly<{businessId:string;binding:string;reference:FinanceMappingReference}>;
const mappingFailure=[...knownFailure,'FINANCE_MAPPING_VERSION_CONFLICT','FINANCE_MAPPING_EFFECTIVE_ORDER_REQUIRED',
 'FINANCE_MAPPING_ACCOUNT_REQUIRED','FINANCE_MAPPING_CLOSURE_REQUIRED'] as const;

const taxPendingKey='crest.finance-tax.pending-reference.v1';
type TaxPending=Readonly<{businessId:string;binding:string;reference:FinanceTaxReference}>;
const taxFailure=[...knownFailure,'FINANCE_TAX_VERSION_CONFLICT','FINANCE_TAX_EFFECTIVE_ORDER_REQUIRED'] as const;

const channelPendingKey='crest.finance-money-channel.pending-reference.v1';
type ChannelPending=Readonly<{businessId:string;binding:string;reference:MoneyChannelReference}>;
const channelFailure=[...knownFailure,'FINANCE_CHANNEL_VERSION_CONFLICT','FINANCE_CHANNEL_EFFECTIVE_ORDER_REQUIRED',
 'FINANCE_CHANNEL_ACCOUNT_REQUIRED','FINANCE_CHANNEL_ACCOUNT_PINNED','FINANCE_CHANNEL_IDENTITY_RETAINED'] as const;

async function post(route:string,body:object,signal:AbortSignal,binding?:string,existingProof?:Proof){
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(40000)]),proof=existingProof??await authentication.session(bounded);
 check(!bounded.aborted&&bindingPattern.test(proof.csrfToken)&&proof.expiresAt>Date.now());
 const response=await fetch('/api/business/finance-accounts/'+route,{
  method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
  headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken,...(binding?{'x-crest-edit-binding':binding}:{})},
  body:JSON.stringify(body),signal:bounded,
 });
 check(response.headers.get('cache-control')?.includes('no-store')
  &&/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??''));
 const reader=response.body?.getReader();check(reader);
 const decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
 try{
  for(;;){
   const part=await reader.read();
   if(part.done)break;
   bytes+=part.value.byteLength;check(bytes<=(route==='trial-balance'?2097152:route==='invoice-preparation'||route==='invoice-draft-read'||route==='invoice-issue-tax-review'
    ||route==='invoice-issue-prepare'||route==='invoice-issue-read'||route==='receipt-options'||route==='expense-post-options'
    ||route==='fund-application-options'||route==='held-tip-options'?1048576:196608)&&!bounded.aborted);
   text+=decoder.decode(part.value,{stream:true});
  }
  text+=decoder.decode();
 }finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();}
 return {status:response.status,value:JSON.parse(text) as unknown,binding:response.headers.get('x-crest-edit-binding'),
  fixedMappings:response.headers.get('x-crest-finance-fixed-mappings')==='1',
  taxProfiles:response.headers.get('x-crest-finance-tax-profiles')==='1',
  categoryMappings:response.headers.get('x-crest-finance-category-mappings')==='1',
  moneyChannels:response.headers.get('x-crest-finance-money-channels')==='1',
  invoicePreparation:response.headers.get('x-crest-invoice-preparation')==='1',
  invoiceDrafts:response.headers.get('x-crest-invoice-drafts')==='1',
  invoiceIssueTaxReview:response.headers.get('x-crest-invoice-issue-tax-review')==='1',
  invoiceIssue:response.headers.get('x-crest-invoice-issue')==='1',
  directReceipts:response.headers.get('x-crest-direct-receipts')==='1',
  paymentCorrections:response.headers.get('x-crest-payment-corrections')==='1',
  fundApplications:response.headers.get('x-crest-fund-applications')==='1',
  heldTips:response.headers.get('x-crest-held-tips')==='1',
  invoiceCredits:response.headers.get('x-crest-invoice-credits')==='1',
  paidInvoiceCredits:response.headers.get('x-crest-paid-invoice-credits')==='1',
  serviceRefunds:response.headers.get('x-crest-service-refunds')==='1',
  sameDayExpenses:response.headers.get('x-crest-same-day-expenses')==='1',
  trialBalance:response.headers.get('x-crest-trial-balance')==='1'};
}

export const financeAccounts={
 async context(signal:AbortSignal,proof?:Proof):Promise<FinanceAccountContext>{
  const {status,value,binding,fixedMappings,taxProfiles,categoryMappings,moneyChannels,invoicePreparation,invoiceDrafts,invoiceIssueTaxReview,invoiceIssue,directReceipts,sameDayExpenses,trialBalance,paymentCorrections,fundApplications,heldTips,invoiceCredits,paidInvoiceCredits,serviceRefunds}=await post('context',{},signal,undefined,proof);
  check(status===200&&binding&&bindingPattern.test(binding)&&exact(value,['businessId','recoveryEpoch','writeState'])
   &&customerUuid(value.businessId)&&(value.writeState==='ready'&&customerUuid(value.recoveryEpoch)
    ||value.writeState==='paused'&&value.recoveryEpoch===null));
  return Object.freeze({...value,binding,fixedMappings,taxProfiles,categoryMappings,moneyChannels,invoicePreparation,invoiceDrafts,invoiceIssueTaxReview,
   ...(invoiceIssue?{invoiceIssue}:{}),...(directReceipts?{directReceipts}:{}),...(sameDayExpenses?{sameDayExpenses}:{}),
   ...(trialBalance?{trialBalance}:{}),...(paymentCorrections?{paymentCorrections}:{}),...(fundApplications?{fundApplications}:{}),
   ...(heldTips?{heldTips}:{}),...(invoiceCredits?{invoiceCredits}:{}),...(paidInvoiceCredits?{paidInvoiceCredits}:{}),...(serviceRefunds?{serviceRefunds}:{})}) as FinanceAccountContext;
 },
 async readTrialBalance(context:FinanceAccountContext,throughOn:string|null,signal:AbortSignal){
  check(context.trialBalance&&(throughOn===null||customerDate(throughOn)));
  const {status,value}=await post('trial-balance',{throughOn},signal,context.binding);
  check(status===200);
  return context.serviceRefunds?parseFictionalTrialBalanceV6(value,context.businessId,throughOn)
   :context.invoiceCredits?parseFictionalTrialBalanceV5(value,context.businessId,throughOn)
   :context.heldTips?parseFictionalTrialBalanceV4(value,context.businessId,throughOn)
   :context.fundApplications?parseFictionalTrialBalanceV3(value,context.businessId,throughOn)
   :context.paymentCorrections?parseFictionalTrialBalanceV2(value,context.businessId,throughOn)
   :parseFictionalTrialBalance(value,context.businessId,throughOn);
 },
 async readPostedJournal(context:FinanceAccountContext,throughOn:string,accountId:string|null,afterLineId:string|null,signal:AbortSignal){
  check(context.trialBalance&&customerDate(throughOn)&&(accountId===null||customerUuid(accountId))&&(afterLineId===null||customerUuid(afterLineId)));
  const {status,value}=await post('posted-journal',{throughOn,accountId,afterLineId},signal,context.binding);
  check(status===200);
  return context.serviceRefunds?parseFictionalJournalV6(value,context.businessId,throughOn,accountId,afterLineId)
   :context.invoiceCredits?parseFictionalJournalV5(value,context.businessId,throughOn,accountId,afterLineId)
   :context.heldTips?parseFictionalJournalV4(value,context.businessId,throughOn,accountId,afterLineId)
   :context.fundApplications?parseFictionalJournalV3(value,context.businessId,throughOn,accountId,afterLineId)
   :context.paymentCorrections?parseFictionalJournalV2(value,context.businessId,throughOn,accountId,afterLineId)
   :parseFictionalJournal(value,context.businessId,throughOn,accountId,afterLineId);
 },
 async sameDayExpenseOptions(context:FinanceAccountContext,expenseId:string,signal:AbortSignal){
  check(context.sameDayExpenses&&customerUuid(expenseId));
  const {status,value}=await post('expense-post-options',{expenseId},signal,context.binding);
  check(status===200);
  return parseSameDayExpenseOptions(value,context.businessId,expenseId);
 },
 async postSameDayExpense(context:FinanceAccountContext,input:ReturnType<typeof parseSameDayExpenseInput>,signal:AbortSignal){
  check(context.sameDayExpenses&&context.writeState==='ready'&&context.recoveryEpoch===input.reference.recoveryEpoch);
  const request=parseSameDayExpenseInput(input);
  const {status,value}=await post('expense-post-submit',request,signal,context.binding);
  if(status===409&&exact(value,['error'])&&typeof value.error==='string')return {state:'refused' as const,reason:value.error};
  check(status===200||status===409);
  const result=parseSameDayExpenseResult(value,context.businessId,request.reference);
  check(result.state==='conflict'||result.state==='retired'||result.state==='committed'&&sameDayExpenseMatchesInput(result,request));
  return result;
 },
 async lookupSameDayExpense(context:FinanceAccountContext,reference:ReturnType<typeof parseSameDayExpenseReference>,signal:AbortSignal){
  check(context.sameDayExpenses);
  const {status,value}=await post('expense-post-lookup',parseSameDayExpenseReference(reference),signal,context.binding);
  check(status===200);
  return parseSameDayExpenseResult(value,context.businessId,reference);
 },
 async retireSameDayExpense(context:FinanceAccountContext,reference:ReturnType<typeof parseSameDayExpenseReference>,reason:string,signal:AbortSignal){
  check(context.sameDayExpenses&&context.writeState==='ready'&&customerUuid(context.recoveryEpoch)&&financeAccountReviewReason(reason));
  const {status,value}=await post('expense-post-retire',{reference:parseSameDayExpenseReference(reference),reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  check(status===200||status===409);
  return parseSameDayExpenseResult(value,context.businessId,reference);
 },
 async directReceiptOptions(context:FinanceAccountContext,customerId:string,actualOn:string|null,signal:AbortSignal){
  check(context.directReceipts&&customerUuid(customerId)&&(actualOn===null||customerDate(actualOn)));
  const {status,value}=await post('receipt-options',{customerId,actualOn},signal,context.binding);
  check(status===200);
  return parseDirectReceiptOptions(value,context.businessId,customerId,actualOn);
 },
 async invoicePaymentAllocations(context:FinanceAccountContext,customerId:string,invoiceId:string,signal:AbortSignal){
  check(context.paymentCorrections&&customerUuid(customerId)&&customerUuid(invoiceId));
  const {status,value}=await post('payment-correction-list',{customerId,invoiceId},signal,context.binding);
  check(status===200);
  return parseInvoicePaymentAllocations(value,context.businessId,customerId,invoiceId);
 },
 async fundApplicationOptions(context:FinanceAccountContext,customerId:string,invoiceId:string,effectiveOn:string|null,signal:AbortSignal){
  check(context.fundApplications&&customerUuid(customerId)&&customerUuid(invoiceId)
   &&(effectiveOn===null||customerDate(effectiveOn)));
  const {status,value}=await post('fund-application-options',{customerId,invoiceId,effectiveOn},signal,context.binding);
  check(status===200);
  return parseFundApplicationOptions(value,context.businessId,customerId,invoiceId,effectiveOn);
 },
 async submitFundApplication(context:FinanceAccountContext,input:ReturnType<typeof parseFundApplicationInput>,signal:AbortSignal){
  check(context.fundApplications&&context.writeState==='ready'&&context.recoveryEpoch===input.reference.recoveryEpoch);
  const request=parseFundApplicationInput(input);
  const {status,value}=await post('fund-application-submit',request,signal,context.binding);
  if(status===409&&exact(value,['error'])&&typeof value.error==='string')return {state:'refused' as const,reason:value.error};
  check(status===200||status===409);
  const result=parseFundApplicationResult(value,context.businessId,request.reference);
  check(result.state==='conflict'||result.state==='committed'&&fundApplicationMatchesInput(result,request));
  return result;
 },
 async lookupFundApplication(context:FinanceAccountContext,reference:ReturnType<typeof parseFundApplicationReference>,signal:AbortSignal){
  check(context.fundApplications);
  const {status,value}=await post('fund-application-lookup',parseFundApplicationReference(reference),signal,context.binding);
  check(status===200||status===409);
  return parseFundApplicationResult(value,context.businessId,reference);
 },
 async retireFundApplication(context:FinanceAccountContext,reference:ReturnType<typeof parseFundApplicationReference>,reason:string,signal:AbortSignal){
  check(context.fundApplications&&context.writeState==='ready'&&customerUuid(context.recoveryEpoch)&&financeAccountReviewReason(reason));
  const {status,value}=await post('fund-application-retire',{reference:parseFundApplicationReference(reference),
   reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  check(status===200||status===409);
  return parseFundApplicationResult(value,context.businessId,reference);
 },
 async invoiceCreditOptions(context:FinanceAccountContext,customerId:string,invoiceId:string,effectiveOn:string|null,signal:AbortSignal){
  check(context.invoiceCredits&&customerUuid(customerId)&&customerUuid(invoiceId)&&(effectiveOn===null||customerDate(effectiveOn)));
  const {status,value}=await post('invoice-credit-options',{customerId,invoiceId,effectiveOn},signal,context.binding);
  check(status===200);
  return parseInvoiceCreditOptions(value,context.businessId,customerId,invoiceId,effectiveOn);
 },
 async paidInvoiceCreditOptions(context:FinanceAccountContext,customerId:string,invoiceId:string,allocationId:string,effectiveOn:string|null,signal:AbortSignal){
  check(context.paidInvoiceCredits&&customerUuid(customerId)&&customerUuid(invoiceId)&&customerUuid(allocationId)
   &&(effectiveOn===null||customerDate(effectiveOn)));
  const {status,value}=await post('paid-invoice-credit-options',{customerId,invoiceId,allocationId,effectiveOn},signal,context.binding);
  check(status===200);
  return parsePairedInvoiceCreditOptions(value,context.businessId,customerId,invoiceId,allocationId,effectiveOn);
 },
 async serviceRefundCredits(context:FinanceAccountContext,customerId:string,invoiceId:string,signal:AbortSignal){
  check(context.serviceRefunds&&customerUuid(customerId)&&customerUuid(invoiceId));
  const {status,value}=await post('service-refund-credits',{customerId,invoiceId},signal,context.binding);
  check(status===200);
  return parseServiceRefundCredits(value,context.businessId,customerId,invoiceId);
 },
 async serviceRefundOptions(context:FinanceAccountContext,customerId:string,pairedCreditId:string,actualOn:string,signal:AbortSignal){
  check(context.serviceRefunds&&customerUuid(customerId)&&customerUuid(pairedCreditId)&&customerDate(actualOn));
  const {status,value}=await post('service-refund-options',{customerId,pairedCreditId,actualOn},signal,context.binding);
  check(status===200);
  return parseServiceRefundOptions(value,context.businessId,customerId,pairedCreditId,actualOn);
 },
 async recordServiceRefund(context:FinanceAccountContext,input:ReturnType<typeof parseServiceRefundInput>,signal:AbortSignal){
  check(context.serviceRefunds&&context.writeState==='ready'&&context.recoveryEpoch===input.reference.recoveryEpoch);
  const request=parseServiceRefundInput(input);
  const {status,value}=await post('service-refund-submit',request,signal,context.binding);
  const reason=status===409&&exact(value,['error'])?serviceRefundRefusal(value.error):null;
  if(reason)return {state:'refused' as const,reason};
  check(status===200||status===409);
  const result=parseServiceRefundResult(value,context.businessId,request.reference);
  check(result.state==='conflict'||result.state==='committed'&&serviceRefundMatchesInput(result.receipt,request));
  return result;
 },
 async lookupServiceRefund(context:FinanceAccountContext,reference:ReturnType<typeof parseServiceRefundReference>,signal:AbortSignal){
  check(context.serviceRefunds);
  const {status,value}=await post('service-refund-lookup',parseServiceRefundReference(reference),signal,context.binding);
  check(status===200||status===409);
  return parseServiceRefundResult(value,context.businessId,reference);
 },
 async retireServiceRefund(context:FinanceAccountContext,reference:ReturnType<typeof parseServiceRefundReference>,reason:string,signal:AbortSignal){
  check(context.serviceRefunds&&context.writeState==='ready'&&customerUuid(context.recoveryEpoch)&&financeAccountReviewReason(reason));
  const {status,value}=await post('service-refund-retire',{reference:parseServiceRefundReference(reference),reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  check(status===200||status===409);
  return parseServiceRefundResult(value,context.businessId,reference);
 },
 async submitPaidInvoiceCredit(context:FinanceAccountContext,input:ReturnType<typeof parsePairedInvoiceCreditInput>,signal:AbortSignal){
  check(context.paidInvoiceCredits&&context.writeState==='ready'&&context.recoveryEpoch===input.credit.reference.recoveryEpoch);
  const request=parsePairedInvoiceCreditInput(input);
  const {status,value}=await post('paid-invoice-credit-submit',request,signal,context.binding);
  const reason=status===409&&exact(value,['error'])?pairedInvoiceCreditRefusal(value.error)??invoiceCreditRefusal(value.error):null;
  if(reason)return {state:'refused' as const,reason};
  check(status===200||status===409);
  const result=parsePairedInvoiceCreditResult(value,context.businessId,request);
  check(result.state==='conflict'||result.state==='committed');
  return result;
 },
 async lookupPaidInvoiceCredit(context:FinanceAccountContext,reference:ReturnType<typeof parsePairedInvoiceCreditReference>,signal:AbortSignal){
  check(context.paidInvoiceCredits);
  const {status,value}=await post('paid-invoice-credit-lookup',parsePairedInvoiceCreditReference(reference),signal,context.binding);
  check(status===200||status===409);
  return parsePairedInvoiceCreditResolution(value,context.businessId,reference);
 },
 async retirePaidInvoiceCredit(context:FinanceAccountContext,reference:ReturnType<typeof parsePairedInvoiceCreditReference>,reason:string,signal:AbortSignal){
  check(context.paidInvoiceCredits&&context.writeState==='ready'&&customerUuid(context.recoveryEpoch)&&financeAccountReviewReason(reason));
  const {status,value}=await post('paid-invoice-credit-retire',{reference:parsePairedInvoiceCreditReference(reference),reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  check(status===200||status===409);
  return parsePairedInvoiceCreditResolution(value,context.businessId,reference);
 },
 async submitInvoiceCredit(context:FinanceAccountContext,input:ReturnType<typeof parseInvoiceCreditInput>,signal:AbortSignal){
  check(context.invoiceCredits&&context.writeState==='ready'&&context.recoveryEpoch===input.reference.recoveryEpoch);
  const request=parseInvoiceCreditInput(input);
  const {status,value}=await post('invoice-credit-submit',request,signal,context.binding);
  const reason=status===409&&exact(value,['error'])?invoiceCreditRefusal(value.error):null;
  if(reason)return {state:'refused' as const,reason};
  check(status===200||status===409);
  const result=parseInvoiceCreditResult(value,context.businessId,request.reference);
  check(result.state==='conflict'||result.state==='committed'&&invoiceCreditMatchesInput(result,request));
  return result;
 },
 async lookupInvoiceCredit(context:FinanceAccountContext,reference:ReturnType<typeof parseInvoiceCreditReference>,signal:AbortSignal){
  check(context.invoiceCredits);
  const {status,value}=await post('invoice-credit-lookup',parseInvoiceCreditReference(reference),signal,context.binding);
  check(status===200||status===409);
  return parseInvoiceCreditResult(value,context.businessId,reference);
 },
 async retireInvoiceCredit(context:FinanceAccountContext,reference:ReturnType<typeof parseInvoiceCreditReference>,reason:string,signal:AbortSignal){
  check(context.invoiceCredits&&context.writeState==='ready'&&customerUuid(context.recoveryEpoch)&&financeAccountReviewReason(reason));
  const {status,value}=await post('invoice-credit-retire',{reference:parseInvoiceCreditReference(reference),reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  check(status===200||status===409);
  return parseInvoiceCreditResult(value,context.businessId,reference);
 },
 async heldTipOptions(context:FinanceAccountContext,customerId:string,jurisdiction:string|null,effectiveOn:string|null,signal:AbortSignal){
  check(context.heldTips&&customerUuid(customerId)&&(jurisdiction===null||financeAccountReviewReason(jurisdiction)&&[...jurisdiction].length<=200)
   &&(effectiveOn===null||customerDate(effectiveOn)));
  const {status,value}=await post('held-tip-options',{customerId,jurisdiction,effectiveOn},signal,context.binding);
  check(status===200);
  return parseHeldTipOptions(value,context.businessId,customerId,jurisdiction,effectiveOn);
 },
 async submitHeldTip(context:FinanceAccountContext,input:ReturnType<typeof parseHeldTipInput>,signal:AbortSignal){
  check(context.heldTips&&context.writeState==='ready'&&context.recoveryEpoch===input.reference.recoveryEpoch);
  const request=parseHeldTipInput(input);
  const {status,value}=await post('held-tip-submit',request,signal,context.binding);
  if(status===409&&exact(value,['error'])&&typeof value.error==='string')return {state:'refused' as const,reason:value.error};
  check(status===200||status===409);
  const result=parseHeldTipResult(value,context.businessId,request.reference);
  check(result.state==='conflict'||result.state==='committed'&&heldTipMatchesInput(result,request));
  return result;
 },
 async lookupHeldTip(context:FinanceAccountContext,reference:ReturnType<typeof parseHeldTipReference>,signal:AbortSignal){
  check(context.heldTips);
  const {status,value}=await post('held-tip-lookup',parseHeldTipReference(reference),signal,context.binding);
  check(status===200||status===409);
  return parseHeldTipResult(value,context.businessId,reference);
 },
 async retireHeldTip(context:FinanceAccountContext,reference:ReturnType<typeof parseHeldTipReference>,reason:string,signal:AbortSignal){
  check(context.heldTips&&context.writeState==='ready'&&customerUuid(context.recoveryEpoch)&&financeAccountReviewReason(reason));
  const {status,value}=await post('held-tip-retire',{reference:parseHeldTipReference(reference),reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  check(status===200||status===409);
  return parseHeldTipResult(value,context.businessId,reference);
 },
 async paymentCorrectionOptions(context:FinanceAccountContext,customerId:string,allocationId:string,effectiveOn:string|null,signal:AbortSignal){
  check(context.paymentCorrections&&customerUuid(customerId)&&customerUuid(allocationId)
   &&(effectiveOn===null||customerDate(effectiveOn)));
  const {status,value}=await post('payment-correction-options',{customerId,allocationId,effectiveOn},signal,context.binding);
  check(status===200);
  return parseAllocationUnapplicationOptions(value,context.businessId,customerId,allocationId,effectiveOn);
 },
 async submitPaymentCorrection(context:FinanceAccountContext,input:ReturnType<typeof parseAllocationUnapplicationInput>,signal:AbortSignal){
  check(context.paymentCorrections&&context.writeState==='ready'&&context.recoveryEpoch===input.reference.recoveryEpoch);
  const request=parseAllocationUnapplicationInput(input);
  const {status,value}=await post('payment-correction-submit',request,signal,context.binding);
  if(status===409&&exact(value,['error'])&&typeof value.error==='string')return {state:'refused' as const,reason:value.error};
  check(status===200||status===409);
  const result=parseAllocationUnapplicationResult(value,context.businessId,request.reference);
  check(result.state==='conflict'||result.state==='committed'&&allocationUnapplicationMatchesInput(result,request));
  return result;
 },
 async lookupPaymentCorrection(context:FinanceAccountContext,reference:ReturnType<typeof parseAllocationUnapplicationReference>,signal:AbortSignal){
  check(context.paymentCorrections);
  const {status,value}=await post('payment-correction-lookup',parseAllocationUnapplicationReference(reference),signal,context.binding);
  check(status===200||status===409);
  return parseAllocationUnapplicationResult(value,context.businessId,reference);
 },
 async retirePaymentCorrection(context:FinanceAccountContext,reference:ReturnType<typeof parseAllocationUnapplicationReference>,reason:string,signal:AbortSignal){
  check(context.paymentCorrections&&context.writeState==='ready'&&customerUuid(context.recoveryEpoch)&&financeAccountReviewReason(reason));
  const {status,value}=await post('payment-correction-retire',{reference:parseAllocationUnapplicationReference(reference),
   reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  check(status===200||status===409);
  return parseAllocationUnapplicationResult(value,context.businessId,reference);
 },
 async recordDirectReceipt(context:FinanceAccountContext,input:ReturnType<typeof parseDirectReceiptInput>,signal:AbortSignal){
  check(context.directReceipts&&context.writeState==='ready'&&context.recoveryEpoch===input.reference.recoveryEpoch);
  const request=parseDirectReceiptInput(input);
  const {status,value}=await post('receipt-record',request,signal,context.binding);
  if(status===409&&exact(value,['error'])&&typeof value.error==='string')return {state:'refused' as const,reason:value.error};
  check(status===200||status===409);
  const result=parseDirectReceiptResult(value,context.businessId,request.reference);
  check(result.state==='conflict'||result.state==='committed'&&directReceiptMatchesInput(result,request));
  return result;
 },
 async lookupDirectReceipt(context:FinanceAccountContext,reference:ReturnType<typeof parseDirectReceiptReference>,signal:AbortSignal){
  check(context.directReceipts);
  const {status,value}=await post('receipt-lookup',parseDirectReceiptReference(reference),signal,context.binding);
  check(status===200);
  return parseDirectReceiptResult(value,context.businessId,reference);
 },
 async retireDirectReceipt(context:FinanceAccountContext,reference:ReturnType<typeof parseDirectReceiptReference>,reason:string,signal:AbortSignal){
  check(context.directReceipts&&context.writeState==='ready'&&customerUuid(context.recoveryEpoch)&&financeAccountReviewReason(reason));
  const {status,value}=await post('receipt-retire',{reference:parseDirectReceiptReference(reference),reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  check(status===200||status===409);
  return parseDirectReceiptResult(value,context.businessId,reference);
 },
 async invoicePreparation(context:FinanceAccountContext,jobId:string,signal:AbortSignal){
  check(context.invoicePreparation&&customerUuid(jobId));
  const {status,value}=await post('invoice-preparation',{jobId},signal,context.binding);
  check(status===200);return parseInvoicePreparation(value,context.businessId,jobId);
 },
 async reviewInvoiceIssueTax(context:FinanceAccountContext,draftId:string,revision:string,jurisdictions:InvoiceIssueJurisdictions,signal:AbortSignal){
  check(context.invoiceIssueTaxReview);
  const input=parseInvoiceIssueTaxRequest({draftId,revision,jurisdictions});
  const {status,value}=await post('invoice-issue-tax-review',input,signal,context.binding);
  check(status===200);
  return parseInvoiceIssueReadiness(value,context.businessId,input);
 },
 async prepareInvoiceIssue(context:FinanceAccountContext,draftId:string,revision:string,jurisdictions:InvoiceIssueJurisdictions,signal:AbortSignal){
  check(context.invoiceIssue);
  const input=parseInvoiceIssueTaxRequest({draftId,revision,jurisdictions});
  const {status,value}=await post('invoice-issue-prepare',input,signal,context.binding);
  check(status===200);
  return parseReviewedInvoiceIssue(value,context.businessId,input);
 },
 async submitInvoiceIssue(context:FinanceAccountContext,input:ReturnType<typeof parseInvoiceIssueRequest>,signal:AbortSignal){
  check(context.invoiceIssue&&context.writeState==='ready'&&context.recoveryEpoch===input.reference.recoveryEpoch);
  const request=parseInvoiceIssueRequest(input);
  const {status,value}=await post('invoice-issue-submit',request,signal,context.binding);
  if(status===409&&exact(value,['error'])&&typeof value.error==='string')return {state:'refused',reason:value.error} as const;
  check(status===200||status===409);
  return parseInvoiceIssueResult(value,context.businessId,request.reference);
 },
 async lookupInvoiceIssue(context:FinanceAccountContext,reference:ReturnType<typeof parseInvoiceIssueReference>,signal:AbortSignal){
  check(context.invoiceIssue);
  const input=parseInvoiceIssueReference(reference);
  const {status,value}=await post('invoice-issue-lookup',input,signal,context.binding);
  check(status===200);
  return parseInvoiceIssueResult(value,context.businessId,input);
 },
 async retireInvoiceIssue(context:FinanceAccountContext,reference:ReturnType<typeof parseInvoiceIssueReference>,reason:string,signal:AbortSignal){
  check(context.invoiceIssue&&context.writeState==='ready'&&customerUuid(context.recoveryEpoch)&&financeAccountReviewReason(reason));
  const input=parseInvoiceIssueReference(reference);
  const {status,value}=await post('invoice-issue-retire',{reference:input,reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  check(status===200||status===409);
  return parseInvoiceIssueResult(value,context.businessId,input);
 },
 async readIssuedInvoice(context:FinanceAccountContext,draftId:string,signal:AbortSignal){
  check(context.invoiceIssue&&customerUuid(draftId));
  const {status,value}=await post('invoice-issue-read',{draftId},signal,context.binding);
  check(status===200);
  return parseIssuedInvoice(value,context.businessId,draftId);
 },
 async readInvoiceSetup(context:FinanceAccountContext,requestedOn:string|null,signal:AbortSignal){
  check(context.invoiceIssue&&(requestedOn===null||customerDate(requestedOn)));
  const {status,value}=await post('invoice-setup-read',{requestedOn},signal,context.binding);
  check(status===200);
  return parseInvoiceSetupRead(value,context.businessId,requestedOn);
 },
 async saveInvoiceSetup(context:FinanceAccountContext,write:ReturnType<typeof parseInvoiceSetupWrite>,signal:AbortSignal){
  check(context.invoiceIssue&&context.writeState==='ready'&&context.recoveryEpoch===write.recoveryEpoch);
  const input=parseInvoiceSetupWrite(write);
  const {status,value}=await post('invoice-setup-save',input,signal,context.binding);
  check(status===200||status===409);
  return parseInvoiceSetupResult(value,context.businessId,input);
 },
 async readInvoiceTaxMapping(context:FinanceAccountContext,jurisdiction:string,signal:AbortSignal){
  check(context.invoiceIssue&&invoiceTaxJurisdiction(jurisdiction));
  const {status,value}=await post('invoice-issue-tax-mapping-read',{jurisdiction},signal,context.binding);
  check(status===200);
  return parseInvoiceTaxMappingEditor(value,context.businessId,jurisdiction);
 },
 async approveInvoiceTaxMapping(context:FinanceAccountContext,approval:ReturnType<typeof parseInvoiceTaxMappingApproval>,signal:AbortSignal){
  check(context.invoiceIssue&&context.writeState==='ready'&&context.recoveryEpoch===approval.recoveryEpoch);
  const request=parseInvoiceTaxMappingApproval(approval);
  const {status,value}=await post('invoice-issue-tax-mapping-approve',{approval:request},signal,context.binding);
  if(status===409&&exact(value,['error'])&&typeof value.error==='string')return {state:'refused',reason:value.error} as const;
  check(status===200||status===409);
  const result=parseInvoiceTaxMappingResult(value,context.businessId,request,request);
  check(result.state!=='absent');
  return result;
 },
 async lookupInvoiceTaxMapping(context:FinanceAccountContext,reference:ReturnType<typeof parseInvoiceTaxMappingReference>,signal:AbortSignal){
  check(context.invoiceIssue);
  const input=parseInvoiceTaxMappingReference(reference);
  const {status,value}=await post('invoice-issue-tax-mapping-lookup',input,signal,context.binding);
  check(status===200);
  return parseInvoiceTaxMappingResult(value,context.businessId,input);
 },
 async readInvoiceExemption(context:FinanceAccountContext,target:ReturnType<typeof parseInvoiceExemptionTarget>,signal:AbortSignal){
  check(context.invoiceIssue);
  const input=parseInvoiceExemptionTarget(target);
  const {status,value}=await post('invoice-issue-exemption-read',input,signal,context.binding);
  check(status===200);
  return parseInvoiceExemptionEditor(value,context.businessId,input);
 },
 async approveInvoiceExemption(context:FinanceAccountContext,approval:ReturnType<typeof parseInvoiceExemptionApproval>,signal:AbortSignal){
  check(context.invoiceIssue&&context.writeState==='ready'&&context.recoveryEpoch===approval.recoveryEpoch);
  const input=parseInvoiceExemptionApproval(approval);
  const {status,value}=await post('invoice-issue-exemption-approve',{approval:input},signal,context.binding);
  check(status===200||status===409);
  return parseInvoiceExemptionResult(value,context.businessId,input);
 },
 async invoiceDrafts(context:FinanceAccountContext,jobId:string,afterDraft:string|null,signal:AbortSignal){
  check(context.invoiceDrafts&&customerUuid(jobId)&&(afterDraft===null||customerUuid(afterDraft)));
  const {status,value}=await post('invoice-draft-list',{jobId,afterDraft},signal,context.binding);
  check(status===200);return parseInvoiceDraftPage(value,context.businessId,jobId,afterDraft);
 },
 async readInvoiceDraft(context:FinanceAccountContext,draftId:string,revision:string|null,signal:AbortSignal){
  check(context.invoiceDrafts&&customerUuid(draftId));
  const {status,value}=await post('invoice-draft-read',{draftId,revision},signal,context.binding);
  check(status===200);return parseInvoiceDraftRead(value,draftId,revision);
 },
 async invoiceDraftOperation(context:FinanceAccountContext,reference:InvoiceDraftReference,signal:AbortSignal){
  check(context.invoiceDrafts);
  const {status,value}=await post('invoice-draft-lookup',parseInvoiceDraftReference(reference),signal,context.binding);
  check(status===200);
  const result=parseInvoiceDraftOperation(value,reference);
  check(result.state!=='conflict'||result.reason==='operation');
  return result;
 },
 async retireInvoiceDraft(context:FinanceAccountContext,reference:InvoiceDraftReference,reason:string,signal:AbortSignal){
  check(context.invoiceDrafts&&context.writeState==='ready'&&context.recoveryEpoch&&financeAccountReviewReason(reason));
  const {status,value}=await post('invoice-draft-retire',{reference,reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  const result=parseInvoiceDraftOperation(value,reference);
  check(status===200&&(result.state==='retired'||result.state==='committed')||status===409&&result.state==='conflict'&&result.reason==='operation');
  return result;
 },
 async saveInvoiceDraft(context:FinanceAccountContext,reference:InvoiceDraftReference,input:InvoiceDraftInput,signal:AbortSignal){
  check(context.invoiceDrafts&&context.writeState==='ready'&&context.recoveryEpoch===reference.recoveryEpoch);
  const draft=parseInvoiceDraftInput(input,parseInvoiceDraftReference(reference));
  const {status,value}=await post('invoice-draft-save',{reference,draft},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const reason=invoiceDraftFailure.find(code=>code===value.error);check(reason);
   return {state:'rejected',reason} as const;
  }
  const result=parseInvoiceDraftOperation(value,reference);
  check(status===200&&result.state==='committed'||status===409&&result.state==='conflict');
  if(result.state==='committed'){
   const saved=result.receipt;
   check(draft.cancelReason===null?saved.state==='draft'&&saved.dueOn===draft.dueOn&&saved.lineCount===draft.outcomes.length
    :saved.state==='cancelled'&&saved.reason===draft.cancelReason);
  }
  return result;
 },
 async moneyChannels(context:FinanceAccountContext,afterChannel:string|null,signal:AbortSignal){
  check(context.moneyChannels);
  const {status,value}=await post('channel-list',{afterChannel},signal,context.binding);
  check(status===200);return parseMoneyChannelPage(value,context.businessId,afterChannel);
 },
 async moneyChannelHistory(context:FinanceAccountContext,channelId:string,beforeVersion:string|null,signal:AbortSignal){
  check(context.moneyChannels);
  const {status,value}=await post('channel-history',{channelId,beforeVersion},signal,context.binding);
  check(status===200);return parseMoneyChannelHistory(value,context.businessId,channelId,beforeVersion);
 },
 async moneyChannelAccounts(context:FinanceAccountContext,kind:MoneyChannelKind,ownershipScope:MoneyChannelScope,afterCode:string|null,signal:AbortSignal){
  check(context.moneyChannels);
  const {status,value}=await post('channel-accounts',{kind,ownershipScope,afterCode},signal,context.binding);
  check(status===200);return parseMoneyChannelAccounts(value,context.businessId,kind,ownershipScope);
 },
 async moneyChannelOperation(context:FinanceAccountContext,reference:MoneyChannelReference,signal:AbortSignal){
  check(context.moneyChannels);
  const {status,value}=await post('channel-lookup',reference,signal,context.binding);
  check(status===200);return parseMoneyChannelOperation(value,context.businessId,reference);
 },
 async saveMoneyChannel(context:FinanceAccountContext,reference:MoneyChannelReference,draft:MoneyChannelDraft,signal:AbortSignal){
  check(context.moneyChannels&&context.writeState==='ready'&&context.recoveryEpoch===reference.recoveryEpoch);
  const {status,value}=await post('channel-save',{reference,draft},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const reason=channelFailure.find(code=>code===value.error);check(reason);
   return {state:'rejected',reason} as const;
  }
  const result=parseMoneyChannelOperation(value,context.businessId,reference);
  check(status===409&&result.state==='conflict'||status===200&&result.state==='committed'&&moneyChannelReceiptMatches(result.receipt,draft));
  return result;
 },
 async retireMoneyChannelOperation(context:FinanceAccountContext,reference:MoneyChannelReference,reason:string,signal:AbortSignal){
  check(context.moneyChannels&&context.writeState==='ready'&&context.recoveryEpoch&&financeAccountReviewReason(reason));
  const {status,value}=await post('channel-retire',{reference,reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const failure=knownFailure.find(code=>code===value.error);check(failure);
   return {state:'rejected',reason:failure} as const;
  }
  const result=parseMoneyChannelOperation(value,context.businessId,reference);
  check(status===409&&result.state==='conflict'||status===200&&(result.state==='committed'
   ||result.state==='retired'&&result.reviewEpoch===context.recoveryEpoch));
  return result;
 },
 async taxHistory(context:FinanceAccountContext,scope:FinanceTaxScope,beforeVersion:string|null,signal:AbortSignal){
  check(context.taxProfiles);
  const {status,value}=await post('tax-history',{...scope,beforeVersion},signal,context.binding);
  check(status===200);return parseFinanceTaxHistory(value,context.businessId,scope,beforeVersion);
 },
 async taxPreview(context:FinanceAccountContext,scope:FinanceTaxScope,date:string,grossCents:string,discountCents:string,signal:AbortSignal){
  check(context.taxProfiles);
  const {status,value}=await post('tax-preview',{...scope,date,grossCents,discountCents},signal,context.binding);
  check(status===200);return parseFinanceTaxPreview(value,context.businessId,scope,date,grossCents,discountCents);
 },
 async taxOperation(context:FinanceAccountContext,reference:FinanceTaxReference,signal:AbortSignal){
  check(context.taxProfiles);
  const {status,value}=await post('tax-operation',reference,signal,context.binding);
  check(status===200);return parseFinanceTaxOperation(value,context.businessId,reference);
 },
 async approveTaxProfile(context:FinanceAccountContext,reference:FinanceTaxReference,approval:FinanceTaxApproval,signal:AbortSignal){
  check(context.taxProfiles&&context.writeState==='ready'&&context.recoveryEpoch===reference.recoveryEpoch);
  const {status,value}=await post('tax-approve',{reference,approval},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const reason=taxFailure.find(code=>code===value.error);check(reason);
   return {state:'rejected',reason} as const;
  }
  const result=parseFinanceTaxOperation(value,context.businessId,reference);
  check(status===409&&result.state==='conflict'||status===200&&result.state==='committed'
   &&matchesFinanceTaxApproval(result.receipt,approval));
  return result;
 },
 async retireTaxApproval(context:FinanceAccountContext,reference:FinanceTaxReference,reason:string,signal:AbortSignal){
  check(context.taxProfiles&&context.writeState==='ready'&&context.recoveryEpoch&&financeAccountReviewReason(reason));
  const {status,value}=await post('tax-retire',{reference,reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const failure=knownFailure.find(code=>code===value.error);check(failure);
   return {state:'rejected',reason:failure} as const;
  }
  const result=parseFinanceTaxOperation(value,context.businessId,reference);
  check(status===409&&result.state==='conflict'||status===200&&(result.state==='committed'
   ||result.state==='retired'&&result.receipt.reviewEpoch===context.recoveryEpoch));
  return result;
 },
 async mappingAt(context:FinanceAccountContext,purpose:FinanceMappingPurpose,date:string,signal:AbortSignal){
  check(context.fixedMappings&&(!expenseCategoryMappingPurpose(purpose)||context.categoryMappings));
  const {status,value}=await post('mapping-at',{purpose,date},signal,context.binding);
  check(status===200);return parseFinanceMappingAt(value,purpose,date);
 },
 async mappingHistory(context:FinanceAccountContext,purpose:FinanceMappingPurpose,beforeVersion:string|null,signal:AbortSignal){
  check(context.fixedMappings&&(!expenseCategoryMappingPurpose(purpose)||context.categoryMappings));
  const {status,value}=await post('mapping-history',{purpose,beforeVersion},signal,context.binding);
  check(status===200);return parseFinanceMappingHistory(value,context.businessId,purpose,beforeVersion);
 },
 async mappingEditor(context:FinanceAccountContext,purpose:FixedFinanceMappingPurpose,signal:AbortSignal){
  check(context.fixedMappings);
  const {status,value}=await post('mapping-editor',{purpose},signal,context.binding);
  check(status===200);return parseFinanceMappingEditor(value,context.businessId,purpose);
 },
 async expenseCategoryAccounts(context:FinanceAccountContext,purpose:ExpenseCategoryMappingPurpose,afterCode:string|null,signal:AbortSignal){
  check(context.fixedMappings&&context.categoryMappings);
  const {status,value}=await post('mapping-category-accounts',{purpose,afterCode},signal,context.binding);
  check(status===200);return parseExpenseCategoryMappingAccounts(value,context.businessId,purpose);
 },
 async mappingOperation(context:FinanceAccountContext,reference:FinanceMappingReference,signal:AbortSignal){
  check(context.fixedMappings&&(!expenseCategoryMappingPurpose(reference.purpose)||context.categoryMappings));
  const {status,value}=await post('mapping-operation',reference,signal,context.binding);
  check(status===200);return parseFinanceMappingOperation(value,context.businessId,reference);
 },
 async approveMapping(context:FinanceAccountContext,reference:FinanceMappingReference,approval:FinanceMappingApproval,signal:AbortSignal){
  check(context.fixedMappings&&(!expenseCategoryMappingPurpose(reference.purpose)||context.categoryMappings)&&context.writeState==='ready'&&context.recoveryEpoch===reference.recoveryEpoch);
  const {status,value}=await post('mapping-approve',{reference,approval},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const reason=mappingFailure.find(code=>code===value.error);check(reason);
   return {state:'rejected',reason} as const;
  }
  const result=parseFinanceMappingOperation(value,context.businessId,reference);
  check(status===409&&result.state==='conflict'||status===200&&result.state==='committed'
   &&result.receipt.accountId===approval.accountId&&result.receipt.effectiveFrom===approval.effectiveFrom
   &&result.receipt.reason===approval.reason);
  return result;
 },
 async retireMappingApproval(context:FinanceAccountContext,reference:FinanceMappingReference,reason:string,signal:AbortSignal){
  check(context.fixedMappings&&(!expenseCategoryMappingPurpose(reference.purpose)||context.categoryMappings)&&context.writeState==='ready'&&context.recoveryEpoch&&financeAccountReviewReason(reason));
  const {status,value}=await post('mapping-retire',{reference,reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const failure=knownFailure.find(code=>code===value.error);check(failure);
   return {state:'rejected',reason:failure} as const;
  }
  const result=parseFinanceMappingOperation(value,context.businessId,reference);
  check(status===409&&result.state==='conflict'||status===200&&(result.state==='committed'
   ||result.state==='retired'&&result.reviewEpoch===context.recoveryEpoch));
  return result;
 },
 async list(context:FinanceAccountContext,afterCode:string|null,includeArchived:boolean,signal:AbortSignal){
  const result=await post('list',{afterCode,includeArchived},signal,context.binding);
  check(result.status===200);return parseFinanceAccountPage(result.value,context.businessId);
 },
 async history(context:FinanceAccountContext,accountId:string,afterVersion:string,signal:AbortSignal){
  const result=await post('history',{accountId,afterVersion},signal,context.binding);
  check(result.status===200);return parseFinanceAccountHistory(result.value,context.businessId,accountId,afterVersion);
 },
 async lookup(context:FinanceAccountContext,reference:FinanceAccountReference,signal:AbortSignal){
  const result=await post('operation',reference,signal,context.binding);
  check(result.status===200);
  return parseFinanceAccountResolution(result.value,context.businessId,reference);
 },
 async retire(context:FinanceAccountContext,reference:FinanceAccountReference,reason:string,signal:AbortSignal){
  check(context.writeState==='ready'&&context.recoveryEpoch&&financeAccountReviewReason(reason));
  const {status,value}=await post('retire',{reference,reviewEpoch:context.recoveryEpoch,reason},signal,context.binding);
  if(status===409&&exact(value,['error'])){
   const failure=knownFailure.find(code=>code===value.error);check(failure);
   return {state:'rejected' as const,reason:failure};
  }
  const decision=parseFinanceAccountResolution(value,context.businessId,reference);
  check(decision.state!=='absent'&&status===(decision.state==='conflict'?409:200)
   &&(decision.state!=='retired'||decision.receipt.reviewEpoch===context.recoveryEpoch));
  return decision;
 },
 async save(context:FinanceAccountContext,reference:FinanceAccountReference,draft:FinanceAccountDraft,signal:AbortSignal){
  check(context.writeState==='ready'&&context.recoveryEpoch===reference.recoveryEpoch);
  const {status,value}=await post('save',{reference,draft},signal,context.binding);
  if(status===409){
   if(exact(value,['error'])){
    const failure=[...knownFailure,'FINANCE_CHANNEL_ACCOUNT_PINNED' as const].find(code=>code===value.error);check(failure);
    return {state:'rejected' as const,reason:failure};
   }
   if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='account'||value.reason==='operation'))
    return {state:'conflict' as const,reason:value.reason};
   if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version')
    return {state:'conflict' as const,reason:'version' as const};
  }
  check(status===200);return parseFinanceAccountReceipt(value,context.businessId,reference);
 },
};

// Only opaque references cross a page reload. Name, account details, and draft
// remain in memory. An absent lookup does not establish that a write failed.
export function readPendingFinanceAccount():Pending|null{
 const raw=sessionStorage.getItem(pendingKey);
 if(raw===null)return null;
 check(raw.length<=1500&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,reference:parseFinanceAccountReference(value.reference)};
}
export function retainPendingFinanceAccount(context:FinanceAccountContext,reference:FinanceAccountReference):Pending{
 check(readPendingFinanceAccount()===null);
 const entry={businessId:context.businessId,binding:context.binding,reference};
 sessionStorage.setItem(pendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingFinanceAccount())===JSON.stringify(entry));
 return entry;
}
export function clearPendingFinanceAccount(entry:Pending){
 check(JSON.stringify(readPendingFinanceAccount())===JSON.stringify(entry));
 sessionStorage.removeItem(pendingKey);
 check(readPendingFinanceAccount()===null);
}

// The saved approval body and review reason stay in memory only.
export function readPendingFinanceMapping():MappingPending|null{
 const raw=sessionStorage.getItem(mappingPendingKey);
 if(raw===null)return null;
 check(raw.length<=1500&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,reference:parseFinanceMappingReference(value.reference)};
}
export function retainPendingFinanceMapping(context:FinanceAccountContext,reference:FinanceMappingReference):MappingPending{
 check(readPendingFinanceMapping()===null);
 const entry={businessId:context.businessId,binding:context.binding,reference};
 sessionStorage.setItem(mappingPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingFinanceMapping())===JSON.stringify(entry));
 return entry;
}
export function clearPendingFinanceMapping(entry:MappingPending){
 check(JSON.stringify(readPendingFinanceMapping())===JSON.stringify(entry));
 sessionStorage.removeItem(mappingPendingKey);
 check(readPendingFinanceMapping()===null);
}

// Tax approvals retain only the original operation reference, never the scope or evidence.
export function readPendingFinanceTax():TaxPending|null{
 const raw=sessionStorage.getItem(taxPendingKey);
 if(raw===null)return null;
 check(raw.length<=1500&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===6);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,reference:parseFinanceTaxReference(value.reference)};
}
export function retainPendingFinanceTax(context:FinanceAccountContext,reference:FinanceTaxReference):TaxPending{
 check(readPendingFinanceTax()===null);
 const entry={businessId:context.businessId,binding:context.binding,reference};
 sessionStorage.setItem(taxPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingFinanceTax())===JSON.stringify(entry));
 return entry;
}
export function clearPendingFinanceTax(entry:TaxPending){
 check(JSON.stringify(readPendingFinanceTax())===JSON.stringify(entry));
 sessionStorage.removeItem(taxPendingKey);
 check(readPendingFinanceTax()===null);
}

// Persist an opaque request reference, never an account identifier, label or opening evidence.
export function readPendingMoneyChannel():ChannelPending|null{
 const raw=sessionStorage.getItem(channelPendingKey);
 if(raw===null)return null;
 check(raw.length<=1500&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,reference:parseMoneyChannelReference(value.reference)};
}
export function retainPendingMoneyChannel(context:FinanceAccountContext,reference:MoneyChannelReference):ChannelPending{
 check(readPendingMoneyChannel()===null);
 const entry={businessId:context.businessId,binding:context.binding,reference};
 sessionStorage.setItem(channelPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingMoneyChannel())===JSON.stringify(entry));
 return entry;
}
export function clearPendingMoneyChannel(entry:ChannelPending){
 check(JSON.stringify(readPendingMoneyChannel())===JSON.stringify(entry));
 sessionStorage.removeItem(channelPendingKey);
 check(readPendingMoneyChannel()===null);
}

type PendingInvoiceDraft=Readonly<{businessId:string;binding:string;reference:InvoiceDraftReference}>;
export function readPendingInvoiceDraft():PendingInvoiceDraft|null{
 const raw=sessionStorage.getItem(invoiceDraftPendingKey);
 if(raw===null)return null;
 check(raw.length<=1500&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===8);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,reference:parseInvoiceDraftReference(value.reference)};
}
export function retainPendingInvoiceDraft(context:FinanceAccountContext,reference:InvoiceDraftReference):PendingInvoiceDraft{
 check(readPendingInvoiceDraft()===null);
 const entry={businessId:context.businessId,binding:context.binding,reference};
 sessionStorage.setItem(invoiceDraftPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingInvoiceDraft())===JSON.stringify(entry));
 return entry;
}
export function clearPendingInvoiceDraft(entry:PendingInvoiceDraft){
 check(JSON.stringify(readPendingInvoiceDraft())===JSON.stringify(entry));
 sessionStorage.removeItem(invoiceDraftPendingKey);
 check(readPendingInvoiceDraft()===null);
}

type PendingInvoiceIssue = Readonly<{businessId:string;binding:string;reference:ReturnType<typeof parseInvoiceIssueReference>}>;
export function readPendingInvoiceIssue():PendingInvoiceIssue|null{
 const raw=sessionStorage.getItem(invoiceIssuePendingKey);
 if(raw===null)return null;
 check(raw.length<=800&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,reference:parseInvoiceIssueReference(value.reference)};
}
export function retainPendingInvoiceIssue(context:FinanceAccountContext,reference:PendingInvoiceIssue['reference']):PendingInvoiceIssue{
 check(readPendingInvoiceIssue()===null);
 const entry={businessId:context.businessId,binding:context.binding,reference};
 sessionStorage.setItem(invoiceIssuePendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingInvoiceIssue())===JSON.stringify(entry));
 return entry;
}
export function clearPendingInvoiceIssue(entry:PendingInvoiceIssue){
 check(JSON.stringify(readPendingInvoiceIssue())===JSON.stringify(entry));
 sessionStorage.removeItem(invoiceIssuePendingKey);
 check(readPendingInvoiceIssue()===null);
}

type PendingDirectReceipt=Readonly<{businessId:string;binding:string;invoiceId:string;reference:ReturnType<typeof parseDirectReceiptReference>}>;
export function readPendingDirectReceipt():PendingDirectReceipt|null{
 const raw=sessionStorage.getItem(directReceiptPendingKey);
 if(raw===null)return null;
 check(raw.length<=800&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','invoiceId','reference'])&&customerUuid(value.businessId)&&customerUuid(value.invoiceId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,invoiceId:value.invoiceId,reference:parseDirectReceiptReference(value.reference)};
}
export function retainPendingDirectReceipt(context:FinanceAccountContext,invoiceId:string,reference:PendingDirectReceipt['reference']){
 check(readPendingDirectReceipt()===null&&customerUuid(invoiceId));
 const entry={businessId:context.businessId,binding:context.binding,invoiceId,reference};
 sessionStorage.setItem(directReceiptPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingDirectReceipt())===JSON.stringify(entry));
 return entry;
}
export function clearPendingDirectReceipt(entry:PendingDirectReceipt){
 check(JSON.stringify(readPendingDirectReceipt())===JSON.stringify(entry));
 sessionStorage.removeItem(directReceiptPendingKey);
 check(readPendingDirectReceipt()===null);
}

type PendingPaymentCorrection=Readonly<{businessId:string;binding:string;invoiceId:string;reference:ReturnType<typeof parseAllocationUnapplicationReference>}>;
export function readPendingPaymentCorrection():PendingPaymentCorrection|null{
 const raw=sessionStorage.getItem(paymentCorrectionPendingKey);
 if(raw===null)return null;
 check(raw.length<=800&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','invoiceId','reference'])&&customerUuid(value.businessId)&&customerUuid(value.invoiceId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,invoiceId:value.invoiceId,reference:parseAllocationUnapplicationReference(value.reference)};
}
export function retainPendingPaymentCorrection(context:FinanceAccountContext,invoiceId:string,reference:PendingPaymentCorrection['reference']){
 check(readPendingPaymentCorrection()===null&&customerUuid(invoiceId));
 const entry={businessId:context.businessId,binding:context.binding,invoiceId,reference:parseAllocationUnapplicationReference(reference)};
 sessionStorage.setItem(paymentCorrectionPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingPaymentCorrection())===JSON.stringify(entry));
 return entry;
}
export function clearPendingPaymentCorrection(entry:PendingPaymentCorrection){
 check(JSON.stringify(readPendingPaymentCorrection())===JSON.stringify(entry));
 sessionStorage.removeItem(paymentCorrectionPendingKey);
 check(readPendingPaymentCorrection()===null);
}

type PendingFundApplication=Readonly<{businessId:string;binding:string;invoiceId:string;reference:ReturnType<typeof parseFundApplicationReference>}>;
export function readPendingFundApplication():PendingFundApplication|null{
 const raw=sessionStorage.getItem(fundApplicationPendingKey);
 if(raw===null)return null;
 check(raw.length<=800&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','invoiceId','reference'])&&customerUuid(value.businessId)&&customerUuid(value.invoiceId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,invoiceId:value.invoiceId,reference:parseFundApplicationReference(value.reference)};
}
export function retainPendingFundApplication(context:FinanceAccountContext,invoiceId:string,reference:PendingFundApplication['reference']){
 check(readPendingFundApplication()===null&&customerUuid(invoiceId));
 const entry={businessId:context.businessId,binding:context.binding,invoiceId,reference:parseFundApplicationReference(reference)};
 sessionStorage.setItem(fundApplicationPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingFundApplication())===JSON.stringify(entry));
 return entry;
}
export function clearPendingFundApplication(entry:PendingFundApplication){
 check(JSON.stringify(readPendingFundApplication())===JSON.stringify(entry));
 sessionStorage.removeItem(fundApplicationPendingKey);
 check(readPendingFundApplication()===null);
}

type PendingPaidInvoiceCredit=Readonly<{businessId:string;binding:string;invoiceId:string;reference:ReturnType<typeof parsePairedInvoiceCreditReference>}>;
type PendingServiceRefund=Readonly<{businessId:string;binding:string;invoiceId:string;reference:ReturnType<typeof parseServiceRefundReference>}>;
const serviceRefundPendingKey='crest.service-refund.pending-reference.v1';
export function readPendingServiceRefund():PendingServiceRefund|null{
 const raw=sessionStorage.getItem(serviceRefundPendingKey);
 if(raw===null)return null;
 check(raw.length<=1000);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','invoiceId','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding)&&customerUuid(value.invoiceId));
 return {businessId:value.businessId,binding:value.binding,invoiceId:value.invoiceId,reference:parseServiceRefundReference(value.reference)};
}
export function retainPendingServiceRefund(context:FinanceAccountContext,invoiceId:string,reference:PendingServiceRefund['reference']){
 check(readPendingServiceRefund()===null&&customerUuid(invoiceId));
 const entry={businessId:context.businessId,binding:context.binding,invoiceId,reference:parseServiceRefundReference(reference)};
 sessionStorage.setItem(serviceRefundPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingServiceRefund())===JSON.stringify(entry));
 return entry;
}
export function clearPendingServiceRefund(entry:PendingServiceRefund){
 check(JSON.stringify(readPendingServiceRefund())===JSON.stringify(entry));
 sessionStorage.removeItem(serviceRefundPendingKey);
 check(readPendingServiceRefund()===null);
}

export function readPendingPaidInvoiceCredit():PendingPaidInvoiceCredit|null{
 const raw=sessionStorage.getItem(paidInvoiceCreditPendingKey);
 if(raw===null)return null;
 check(raw.length<=1000);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','invoiceId','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding)&&customerUuid(value.invoiceId));
 return {businessId:value.businessId,binding:value.binding,invoiceId:value.invoiceId,reference:parsePairedInvoiceCreditReference(value.reference)};
}
export function retainPendingPaidInvoiceCredit(context:FinanceAccountContext,invoiceId:string,reference:PendingPaidInvoiceCredit['reference']){
 check(readPendingPaidInvoiceCredit()===null&&customerUuid(invoiceId));
 const entry={businessId:context.businessId,binding:context.binding,invoiceId,reference:parsePairedInvoiceCreditReference(reference)};
 sessionStorage.setItem(paidInvoiceCreditPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingPaidInvoiceCredit())===JSON.stringify(entry));
 return entry;
}
export function clearPendingPaidInvoiceCredit(entry:PendingPaidInvoiceCredit){
 check(JSON.stringify(readPendingPaidInvoiceCredit())===JSON.stringify(entry));
 sessionStorage.removeItem(paidInvoiceCreditPendingKey);
 check(readPendingPaidInvoiceCredit()===null);
}

type PendingInvoiceCredit=Readonly<{businessId:string;binding:string;invoiceId:string;reference:ReturnType<typeof parseInvoiceCreditReference>}>;
export function readPendingInvoiceCredit():PendingInvoiceCredit|null{
 const raw=sessionStorage.getItem(invoiceCreditPendingKey);
 if(raw===null)return null;
 check(raw.length<=1000);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','invoiceId','reference'])&&customerUuid(value.businessId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding)&&customerUuid(value.invoiceId));
 return {businessId:value.businessId,binding:value.binding,invoiceId:value.invoiceId,reference:parseInvoiceCreditReference(value.reference)};
}
export function retainPendingInvoiceCredit(context:FinanceAccountContext,invoiceId:string,reference:PendingInvoiceCredit['reference']){
 check(readPendingInvoiceCredit()===null&&customerUuid(invoiceId));
 const entry={businessId:context.businessId,binding:context.binding,invoiceId,reference:parseInvoiceCreditReference(reference)};
 sessionStorage.setItem(invoiceCreditPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingInvoiceCredit())===JSON.stringify(entry));
 return entry;
}
export function clearPendingInvoiceCredit(entry:PendingInvoiceCredit){
 check(JSON.stringify(readPendingInvoiceCredit())===JSON.stringify(entry));
 sessionStorage.removeItem(invoiceCreditPendingKey);
 check(readPendingInvoiceCredit()===null);
}

type PendingHeldTip=Readonly<{businessId:string;binding:string;customerId:string;reference:ReturnType<typeof parseHeldTipReference>}>;
export function readPendingHeldTip():PendingHeldTip|null{
 const raw=sessionStorage.getItem(heldTipPendingKey);
 if(raw===null)return null;
 check(raw.length<=800&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','customerId','reference'])&&customerUuid(value.businessId)&&customerUuid(value.customerId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,customerId:value.customerId,reference:parseHeldTipReference(value.reference)};
}

export function retainPendingHeldTip(context:FinanceAccountContext,customerId:string,reference:PendingHeldTip['reference']){
 check(readPendingHeldTip()===null&&customerUuid(customerId));
 const entry={businessId:context.businessId,binding:context.binding,customerId,reference:parseHeldTipReference(reference)};
 sessionStorage.setItem(heldTipPendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingHeldTip())===JSON.stringify(entry));
 return entry;
}

export function clearPendingHeldTip(entry:PendingHeldTip){
 check(JSON.stringify(readPendingHeldTip())===JSON.stringify(entry));
 sessionStorage.removeItem(heldTipPendingKey);
 check(readPendingHeldTip()===null);
}

type PendingSameDayExpense=Readonly<{businessId:string;binding:string;expenseId:string;reference:ReturnType<typeof parseSameDayExpenseReference>}>;
export function readPendingSameDayExpense():PendingSameDayExpense|null{
 const raw=sessionStorage.getItem(sameDayExpensePendingKey);
 if(raw===null)return null;
 check(raw.length<=800&&(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===7);
 const value:unknown=JSON.parse(raw);
 check(exact(value,['businessId','binding','expenseId','reference'])&&customerUuid(value.businessId)&&customerUuid(value.expenseId)
  &&typeof value.binding==='string'&&bindingPattern.test(value.binding));
 return {businessId:value.businessId,binding:value.binding,expenseId:value.expenseId,reference:parseSameDayExpenseReference(value.reference)};
}
export function retainPendingSameDayExpense(context:FinanceAccountContext,expenseId:string,reference:PendingSameDayExpense['reference']){
 check(readPendingSameDayExpense()===null&&customerUuid(expenseId));
 const entry={businessId:context.businessId,binding:context.binding,expenseId,reference};
 sessionStorage.setItem(sameDayExpensePendingKey,JSON.stringify(entry));
 check(JSON.stringify(readPendingSameDayExpense())===JSON.stringify(entry));
 return entry;
}
export function clearPendingSameDayExpense(entry:PendingSameDayExpense){
 check(JSON.stringify(readPendingSameDayExpense())===JSON.stringify(entry));
 sessionStorage.removeItem(sameDayExpensePendingKey);
 check(readPendingSameDayExpense()===null);
}

export function downloadFinanceHistory(filename:string,rows:readonly (readonly string[])[]){
 const csv=(value:string)=>{
  const escaped=/^[=+\-@']/.test(value.trimStart())?"'"+value:value;
  return '"'+escaped.replaceAll('"','""')+'"';
 };
 const data=rows.map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n';
 const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;link.download=filename;link.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
