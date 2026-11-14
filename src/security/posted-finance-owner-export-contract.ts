export const postedFinanceExportPath='/api/business/exports/posted-finance';
export const postedFinanceExportName='crest-posted-finance.zip';
export const postedFinanceExportLimit=8*1024*1024;
export const postedFinanceExportProfile='crest.posted-finance-source.v7';
export const excessReceiptExportProfile='crest.posted-finance-source.v8';
export const excessReturnExportProfile='crest.posted-finance-source.v9';
export const tipReturnExportProfile='crest.posted-finance-source.v10';

export function postedFinanceProfileForSchema(sourceSchemaVersion:number){
 return sourceSchemaVersion>=94?tipReturnExportProfile:sourceSchemaVersion>=93?excessReturnExportProfile
  :sourceSchemaVersion>=91?excessReceiptExportProfile:postedFinanceExportProfile;
}
