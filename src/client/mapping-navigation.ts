import {customerDate} from '../customer/customer-contract';
import {expenseCategoryMappingPurpose,fixedFinanceMappingPurpose} from '../bookkeeping/finance-mapping-contract';
import type {FinanceMappingPurpose} from '../bookkeeping/finance-mapping-contract';

// Only public configuration labels and a lookup date belong in return links.
// The lookup date never pre-fills an approval's effective date.
export function readMappingNavigation(input:Readonly<Record<string,unknown>>,categories:boolean):Readonly<{purpose:FinanceMappingPurpose|'';date:string}>{
 const accepts=categories?expenseCategoryMappingPurpose:fixedFinanceMappingPurpose;
 return {purpose:accepts(input.purpose)?input.purpose:'',date:customerDate(input.lookupOn)?input.lookupOn:''};
}

export function mappingNavigationHref(categories:boolean,manage:boolean,input:Readonly<Record<string,unknown>>):string{
 const {purpose,date}=readMappingNavigation(input,categories);
 const params=new URLSearchParams();
 if(purpose)params.set('purpose',purpose);
 if(date)params.set('lookupOn',date);
 const path='/settings/accounts/mappings'+(categories?'/categories':'')+(manage?'/manage':'');
 return path+(params.size?'?'+params.toString():'');
}
