export const postedFinanceExportPath='/api/business/exports/posted-finance';
export const postedFinanceExportName='crest-posted-finance.zip';
export const postedFinanceExportLimit=8*1024*1024;
export const postedFinanceExportProfile='crest.posted-finance-source.v7';
export const excessReceiptExportProfile='crest.posted-finance-source.v8';
export const excessReturnExportProfile='crest.posted-finance-source.v9';
export const tipReturnExportProfile='crest.posted-finance-source.v10';
export const collectionFailureExportProfile='crest.posted-finance-source.v11';
export const refundTransferExportProfile='crest.posted-finance-source.v12';
export const directReceiptTipExportProfile='crest.posted-finance-source.v13';
export const refundTransferFeeExportProfile='crest.posted-finance-source.v14';
export const collectionFailureRecreditExportProfile='crest.posted-finance-source.v15';
export const collectionFailureGroupedRecreditExportProfile='crest.posted-finance-source.v16';

export const restoredTipExportProfile='crest.posted-finance-source.v17';
export const openingWorksheetExportProfile='crest.posted-finance-source.v18';

export const supplierPayablesExportProfile='crest.posted-finance-source.v23';
export const supplierBillDraftsExportProfile='crest.posted-finance-source.v22';
export const statementMatchDraftsExportProfile='crest.posted-finance-source.v21';
export const openingReceivablesExportProfile='crest.posted-finance-source.v20';
export const statementStagingExportProfile='crest.posted-finance-source.v19';

export function postedFinanceProfileForSchema(sourceSchemaVersion:number){
 const schema=financePostingSchema(sourceSchemaVersion);
 if(!Number.isSafeInteger(sourceSchemaVersion)||schema===undefined||schema<89||schema>109)throw Error('POSTED_FINANCE_EXPORT_CONFIGURATION_REQUIRED');
 return schema>=109?supplierPayablesExportProfile:schema>=108?supplierBillDraftsExportProfile:schema>=107?statementMatchDraftsExportProfile:schema>=105?openingReceivablesExportProfile:schema>=103?statementStagingExportProfile:schema>=102?openingWorksheetExportProfile:schema>=101?restoredTipExportProfile:schema>=100?collectionFailureGroupedRecreditExportProfile:schema>=99?collectionFailureRecreditExportProfile:schema>=98?refundTransferFeeExportProfile:schema>=97?directReceiptTipExportProfile:schema>=96?refundTransferExportProfile:schema>=95?collectionFailureExportProfile:schema>=94?tipReturnExportProfile:schema>=93?excessReturnExportProfile
  :schema>=91?excessReceiptExportProfile:postedFinanceExportProfile;
}
import {financePostingSchema} from '../bookkeeping/finance-posting-schema.ts';
