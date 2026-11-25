// Reviewed candidate observations; original138 baselines remain unchanged.
import {instanceSourceInventory138} from './instance-source-inventory138.ts';
import {openingFundsSourceCoverage} from '../bookkeeping/opening-funds-source-columns.ts';
export {openingFunds139SourceProfile} from './opening-funds139-catalog.ts';
export const openingFunds139SourceInventory=Object.freeze([
 ...instanceSourceInventory138,
 ...openingFundsSourceCoverage.map(row=>Object.freeze({source:row.table,columns:Object.freeze([...row.required]),excluded:Object.freeze([] as string[])})),
].sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:0));
