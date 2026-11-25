import 'server-only';

// Explicit registered finance modes. Private supplier-object delivery is adopted
// separately; declaring finance cannot fabricate an available upload worker.
export const financeRuntimeFeatureNames=['fixedMappings','mappingHistoryEvidence','historyEvidence','taxProfiles','categoryMappings','moneyChannels','invoicePreparation','invoiceDrafts','invoiceIssueTaxReview','invoiceIssue','invoiceOutstanding','directReceipts','sameDayExpenses','trialBalance','paymentCorrections','fundApplications','heldTips','invoiceCredits','paidInvoiceCredits','serviceRefunds','receivableAging','customerFundsReport','excessReceipts','excessReturns','tipReturns','collectionFailures','refundTransfers','directReceiptTips','refundTransferFees','collectionFailureRecredits','collectionFailureGroupedRecredits','collectionFailureTipReinstatements','openingWorksheet','openingArPreview','openingFunds','statementStaging','statementMatchReview','statementMatchDrafts','supplierBillDrafts','supplierPayableReview','supplierPayablePosting','recordedIncomeStatement'] as const;
export type FinanceRuntimeFeature=typeof financeRuntimeFeatureNames[number];
export type FinanceRuntimeFeatures=Readonly<Partial<Record<FinanceRuntimeFeature,boolean>>>;
export type ProductionFinanceConfiguration=Readonly<{connectionString:string;features:FinanceRuntimeFeatures}>;
const dependencies:Partial<Record<FinanceRuntimeFeature,readonly FinanceRuntimeFeature[]>>={
 mappingHistoryEvidence:['fixedMappings'],categoryMappings:['fixedMappings'],invoiceDrafts:['invoicePreparation'],invoiceIssueTaxReview:['invoiceDrafts','taxProfiles'],invoiceIssue:['invoiceIssueTaxReview','fixedMappings'],invoiceOutstanding:['invoiceIssue'],
 directReceipts:['invoiceIssue','moneyChannels'],sameDayExpenses:['directReceipts','categoryMappings'],trialBalance:['sameDayExpenses'],paymentCorrections:['trialBalance'],fundApplications:['paymentCorrections'],heldTips:['fundApplications','taxProfiles'],invoiceCredits:['heldTips'],paidInvoiceCredits:['invoiceCredits'],serviceRefunds:['paidInvoiceCredits','directReceipts'],
 receivableAging:['serviceRefunds'],customerFundsReport:['serviceRefunds'],excessReceipts:['directReceipts','customerFundsReport'],excessReturns:['excessReceipts'],tipReturns:['excessReturns','heldTips'],collectionFailures:['tipReturns','trialBalance'],refundTransfers:['collectionFailures','serviceRefunds'],directReceiptTips:['refundTransfers','excessReceipts','taxProfiles'],refundTransferFees:['refundTransfers','directReceiptTips'],
 collectionFailureRecredits:['refundTransferFees','collectionFailures','fundApplications'],collectionFailureGroupedRecredits:['collectionFailureRecredits'],collectionFailureTipReinstatements:['collectionFailureGroupedRecredits'],
 openingWorksheet:['moneyChannels'],openingArPreview:['openingWorksheet'],openingFunds:['openingWorksheet'],statementStaging:['moneyChannels'],statementMatchReview:['statementStaging'],statementMatchDrafts:['statementMatchReview'],supplierBillDrafts:['moneyChannels'],supplierPayableReview:['supplierBillDrafts'],supplierPayablePosting:['supplierPayableReview'],recordedIncomeStatement:['trialBalance','refundTransfers'],
};
function require(value:unknown):asserts value{if(!value)throw new Error('PRODUCTION_FINANCE_CONFIGURATION_REQUIRED');}
export function financeRuntimeFeatures(value:unknown):FinanceRuntimeFeatures{
 require(Array.isArray(value)&&new Set(value).size===value.length&&value.every(item=>financeRuntimeFeatureNames.includes(item)));
 return validateFinanceRuntimeFeatures(Object.fromEntries(value.map(name=>[name,true])));
}
export function validateFinanceRuntimeFeatures(value:unknown):FinanceRuntimeFeatures{
 require(value!==null&&typeof value==='object'&&!Array.isArray(value));
 const object=value as Record<string,unknown>;
 require(Object.keys(object).every(name=>financeRuntimeFeatureNames.some(known=>known===name)&&typeof object[name]==='boolean'));
 const features=Object.freeze({...object}) as FinanceRuntimeFeatures;
 for(const name of financeRuntimeFeatureNames)if(features[name])for(const dependency of dependencies[name]??[])require(features[dependency]===true);
 return features;
}
export function validateFinanceRuntimeDependencies(features:FinanceRuntimeFeatures,enabled:(capability:'jobCompletion'|'expenses')=>boolean){
 require(!features.invoicePreparation||enabled('jobCompletion'));
 require(!features.sameDayExpenses||enabled('expenses'));
}
export function validateFinanceRuntimeConnection(webConnection:string,financeConnection:string){
 try{
  const web=new URL(webConnection),finance=new URL(financeConnection);
  for(const connection of [web,finance])require(['postgres:','postgresql:'].includes(connection.protocol)&&connection.username&&connection.password&&connection.pathname.length>1&&!connection.search&&!connection.hash);
  require(web.hostname===finance.hostname&&web.port===finance.port&&web.pathname===finance.pathname&&decodeURIComponent(web.username)!==decodeURIComponent(finance.username));
 }catch{throw new Error('PRODUCTION_FINANCE_CONFIGURATION_REQUIRED');}
}
