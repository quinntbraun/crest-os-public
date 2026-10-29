import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {pendingQuoteReview,createPendingQuoteReviewStore,pendingQuoteReviewKey,quoteReviewOriginalReference} from '../../src/client/pending-quote-review';
function record(){return {schemaVersion:1,businessId:randomUUID(),binding:randomBytes(32).toString('base64url'),reference:{action:'submit',operationId:randomUUID(),recoveryEpoch:randomUUID(),familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'3',expectedRevisionVersion:'3',expectedContentVersion:'2',approvalId:null}};}
it('retains only exact opaque review identities and refuses content, hashes and unexpected getters',()=>{
 const value=record(),pinned=pendingQuoteReview(value);expect(pinned).toEqual(value);expect(Object.isFrozen(pinned.reference)).toBe(true);expect(quoteReviewOriginalReference(pinned.reference)).not.toHaveProperty('action');expect(quoteReviewOriginalReference(pinned.reference)).not.toHaveProperty('approvalId');
 for(const extra of [{expectedHash:'a'.repeat(64)},{notes:'Private quote'},{amount:'12500'},{email:'private@example.com'}])expect(()=>pendingQuoteReview({...value,reference:{...value.reference,...extra}})).toThrow();
 let accessed=false;const trapped={...value,reference:{...value.reference}};Object.defineProperty(trapped.reference,'familyId',{enumerable:true,get(){accessed=true;return value.reference.familyId;}});expect(()=>pendingQuoteReview(trapped)).toThrow();expect(accessed).toBe(false);
 expect(()=>pendingQuoteReview({...value,reference:{...value.reference,expectedContentVersion:'4'}})).toThrow();
});
it('confirms storage before dispatch and refuses overwrites or clearing a changed original',()=>{
 const memory=new Map<string,string>(),storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}},store=createPendingQuoteReviewStore(storage),pinned=pendingQuoteReview(record());
 store.write(pinned);expect(store.read()).toEqual(pinned);expect(()=>store.write(pinned)).toThrow();const changed=pendingQuoteReview({...pinned,reference:{...pinned.reference,operationId:randomUUID()}});expect(()=>store.clear(changed)).toThrow();expect(memory.has(pendingQuoteReviewKey)).toBe(true);store.clear(pinned);expect(store.read()).toBeNull();
 const failed=createPendingQuoteReviewStore({...storage,setItem:()=>{}});expect(()=>failed.write(pinned)).toThrow();
});
