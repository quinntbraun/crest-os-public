import {requireFinanceAccount as check} from './finance-account-contract.ts';
import {fictionalJournalV14PageSize,parseFictionalJournalV14} from './posted-report-v14-contract.ts';

export const fictionalJournalV15PageSize=fictionalJournalV14PageSize;

export function parseFictionalJournalV15(input:unknown,businessId:string,throughOn:string,accountId:string|null,afterLineId:string|null,
  pageSize=fictionalJournalV15PageSize){
  check(input!==null&&typeof input==='object'&&!Array.isArray(input));
  const report=input as Record<string,unknown>;
  check(report.schemaVersion===15);
  const parsed=parseFictionalJournalV14({...report,schemaVersion:14},businessId,throughOn,accountId,afterLineId,pageSize,true);
  return {...parsed,schemaVersion:15 as const};
}
export type FictionalJournalV15=ReturnType<typeof parseFictionalJournalV15>;
