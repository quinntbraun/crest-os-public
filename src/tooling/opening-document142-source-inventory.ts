// Candidate inventory only. Registered141 and older captures remain unchanged.
import {openingSupplier141SourceInventory} from './opening-supplier141-source-inventory.ts';
import {openingDocumentSourceCoverage} from '../bookkeeping/opening-document-source-columns.ts';
export const openingDocument142SourceInventory=Object.freeze([
 ...openingSupplier141SourceInventory,
 ...openingDocumentSourceCoverage.map(row=>Object.freeze({source:row.table,columns:row.required,excluded:row.excluded})),
].sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:0));
