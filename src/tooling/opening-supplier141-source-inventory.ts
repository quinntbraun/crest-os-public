// Literal source inventory for the proposed supplier increment, not release authority.
import {openingFunds139SourceInventory} from './opening-funds139-source-profile.ts';
import {openingPayablesSourceCoverage} from '../bookkeeping/opening-payables-source-columns.ts';
import {openingAllocationsSourceCoverage} from '../bookkeeping/opening-allocations-source-columns.ts';
export const openingSupplier141SourceInventory=Object.freeze([
 ...openingFunds139SourceInventory,
 ...[...openingPayablesSourceCoverage,...openingAllocationsSourceCoverage].map(row=>Object.freeze({source:row.table,columns:Object.freeze([...row.required]),excluded:Object.freeze([] as string[])})),
].sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:0));
