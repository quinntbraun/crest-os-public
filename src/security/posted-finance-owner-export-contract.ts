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

export function postedFinanceProfileForSchema(sourceSchemaVersion:number){
 return sourceSchemaVersion>=99?collectionFailureRecreditExportProfile:sourceSchemaVersion>=98?refundTransferFeeExportProfile:sourceSchemaVersion>=97?directReceiptTipExportProfile:sourceSchemaVersion>=96?refundTransferExportProfile:sourceSchemaVersion>=95?collectionFailureExportProfile:sourceSchemaVersion>=94?tipReturnExportProfile:sourceSchemaVersion>=93?excessReturnExportProfile
  :sourceSchemaVersion>=91?excessReceiptExportProfile:postedFinanceExportProfile;
}
