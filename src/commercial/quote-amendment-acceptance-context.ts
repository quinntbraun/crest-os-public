// Exact root identities from the accepted parent; current portions are loaded
// separately and all observations are rechecked by the acceptance transaction.
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion,quoteResponseLimit} from './quote-storage-contract.ts';
import {quoteReviewHash} from './quote-review-contract.ts';
export type AcceptanceRoot=Readonly<{stableLineKey:string;entitlementId:string;entitlementVersionId:string;sourceAllocationId:string;sourcePartitionId:string;authorizationState:'active'|'withdrawn'}>;
export type AcceptanceScopeBinding=Readonly<{businessId:string;familyId:string;revisionId:string;familyVersion:string;contentHash:string;parentAgreementId:string;parentAgreementVersion:string;parentAcceptedHash:string}>;
const bindings=['businessId','familyId','revisionId','familyVersion','contentHash','parentAgreementId','parentAgreementVersion','parentAcceptedHash'] as const;
const rootKeys=['stableLineKey','entitlementId','entitlementVersionId','sourceAllocationId','sourcePartitionId','authorizationState'] as const;
function check(v:unknown):asserts v{if(!v)throw Error('AMENDMENT_ACCEPTANCE_SCOPE_REQUIRED');}
export function parseAcceptanceScopeBinding(value:unknown):AcceptanceScopeBinding{
 check(exact(value,bindings)&&['businessId','familyId','revisionId','parentAgreementId'].every(k=>quoteId(value[k]))&&quoteVersion(value.familyVersion)&&quoteVersion(value.parentAgreementVersion)&&quoteReviewHash(value.contentHash)&&quoteReviewHash(value.parentAcceptedHash));return Object.freeze({...value}) as AcceptanceScopeBinding;
}
export function parseAcceptanceScope(value:unknown,input:AcceptanceScopeBinding){
 const expected=parseAcceptanceScopeBinding(input);check(exact(value,['schemaVersion',...bindings,'roots'])&&value.schemaVersion===1&&bindings.every(k=>value[k]===expected[k])&&Array.isArray(value.roots)&&value.roots.length>0&&value.roots.length<=1000&&new TextEncoder().encode(JSON.stringify(value)).length<=quoteResponseLimit);
 const roots=value.roots.map(root=>{check(exact(root,rootKeys)&&rootKeys.filter(k=>k!=='authorizationState').every(k=>quoteId(root[k]))&&['active','withdrawn'].includes(root.authorizationState as string));return Object.freeze({...root}) as AcceptanceRoot;});for(const key of rootKeys.filter(k=>k!=='authorizationState'))check(new Set(roots.map(r=>r[key])).size===roots.length);
 return Object.freeze({schemaVersion:1 as const,...expected,roots:Object.freeze(roots)});
}
