import type {parseFinanceMappingHistory} from './finance-mapping-contract';
type Row=ReturnType<typeof parseFinanceMappingHistory>['rows'][number];
// History is already validated newest-first with consecutive versions and
// strictly increasing effective dates. End dates are exclusive. No current
// posting eligibility or missing older period is inferred here.
export function financeMappingPeriods(rows:readonly Row[]){
 return rows.map((row,index)=>({row,effectiveFrom:row.effectiveFrom,effectiveUntil:index===0?null:rows[index-1]!.effectiveFrom}));
}
