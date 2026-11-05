import {randomBytes} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {createPendingQuoteAmendmentStore,pendingQuoteAmendment,pendingQuoteAmendmentKeys,PendingQuoteAmendmentError} from '../../src/client/pending-quote-amendment';
import type {PendingQuoteAmendment,QuoteAmendmentPendingKind} from '../../src/client/pending-quote-amendment';
import {originalOperationFixture} from '../support/original-operation-fixture';

const kinds=['quote.amendment.create','quote.amendment.send','quote.amendment.accept'] as const;
function fixture<K extends QuoteAmendmentPendingKind>(kind:K){
 const original=originalOperationFixture(kind),value=pendingQuoteAmendment(kind,{schemaVersion:1,businessId:original.businessId,binding:randomBytes(32).toString('base64url'),reference:original.reference});
 const memory=new Map<string,string>(),storage={getItem:vi.fn((key:string)=>memory.get(key)??null),setItem:vi.fn((key:string,value:string)=>{memory.set(key,value);}),removeItem:vi.fn((key:string)=>{memory.delete(key);})};
 return {value,memory,storage,key:pendingQuoteAmendmentKeys[kind],store:createPendingQuoteAmendmentStore(storage,kind)};
}
describe.each(kinds)('%s pending identity',kind=>{
 it('survives reopening with only the exact opaque original and a frozen reference',()=>{
  const f=fixture(kind);expect(f.store.read()).toBeNull();f.store.write(f.value);
  const reopened=createPendingQuoteAmendmentStore(f.storage,kind);expect(reopened.read()).toEqual(f.value);reopened.require(f.value);
  expect(Object.isFrozen(reopened.read())).toBe(true);expect(Object.isFrozen(reopened.read()!.reference)).toBe(true);
  expect(Object.keys(f.value.reference).length).toBe(kind==='quote.amendment.create'?8:kind==='quote.amendment.send'?12:13);expect(f.memory.get(f.key)!.length).toBeLessThan(2048);
  expect(Object.keys(f.value)).toEqual(['schemaVersion','businessId','binding','reference']);
  for(const other of kinds.filter(other=>other!==kind))expect(createPendingQuoteAmendmentStore(f.storage,other).read()).toBeNull();
 });
 it('refuses overwrite even with the same reference and clears only that pinned record',()=>{
  const f=fixture(kind);f.store.write(f.value);expect(()=>f.store.write(f.value)).toThrow(PendingQuoteAmendmentError);expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  expect(()=>f.store.clear({...f.value,binding:randomBytes(32).toString('base64url')})).toThrow(PendingQuoteAmendmentError);expect(f.storage.removeItem).not.toHaveBeenCalled();
  f.store.clear(f.value);expect(f.store.read()).toBeNull();expect(()=>f.store.require(f.value)).toThrow(PendingQuoteAmendmentError);
 });
 it.each(['content','expectedParentAcceptedHash','amountCents','recipient','password','evidenceNote'])('rejects private payload %s in either envelope or reference',key=>{
  const f=fixture(kind);for(const value of [{...f.value,[key]:'PRIVATE'},{...f.value,reference:{...f.value.reference,[key]:'PRIVATE'}}]){
   expect(()=>f.store.write(value)).toThrow(PendingQuoteAmendmentError);expect(f.storage.setItem).not.toHaveBeenCalled();
  }
 });
 it.each(['getter','hidden','symbol','prototype','array'])('rejects a %s property without running getters',fault=>{
  const f=fixture(kind),getter=vi.fn(()=>f.value.binding);
  for(const location of ['root','reference']){
   const value=structuredClone(f.value),target=location==='root'?value:value.reference;
   if(fault==='getter')Object.defineProperty(target,location==='root'?'binding':'operationId',{get:getter,enumerable:true});
   if(fault==='hidden')Object.defineProperty(target,'private',{value:'PRIVATE'});
   if(fault==='symbol')Object.defineProperty(target,Symbol('private'),{value:'PRIVATE',enumerable:true});
   if(fault==='prototype')Object.setPrototypeOf(target,{private:'PRIVATE'});
   if(fault==='array'){if(location==='root'){expect(()=>pendingQuoteAmendment(kind,[value])).toThrow(PendingQuoteAmendmentError);continue;}Object.assign(value,{reference:[value.reference]});}
   expect(()=>pendingQuoteAmendment(kind,value)).toThrow(PendingQuoteAmendmentError);
  }
  expect(getter).not.toHaveBeenCalled();
 });
 it.each(['binding','parent','version','kind'])('refuses malformed or cross-kind %s without replacing storage',fault=>{
  const f=fixture(kind),value=structuredClone(f.value);
  if(fault==='binding')Object.assign(value,{binding:'a'.repeat(43)});
  if(fault==='parent')Object.assign(value.reference,{expectedParentAgreementId:'not-an-id'});
  if(fault==='version')Object.assign(value.reference,{expectedParentAgreementVersion:'0'});
  if(fault==='kind')Object.assign(value,{reference:fixture(kind==='quote.amendment.create'?'quote.amendment.send':'quote.amendment.create').value.reference});
  expect(()=>f.store.write(value)).toThrow(PendingQuoteAmendmentError);expect(f.storage.setItem).not.toHaveBeenCalled();
 });
 it.each(['malformed','oversized','get','set','readback','remove','remove-readback'])('retains a failure for explicit review on %s storage',fault=>{
  const f=fixture(kind);
  if(fault==='malformed'||fault==='oversized'){f.memory.set(f.key,fault==='malformed'?'{':' '.repeat(4097));expect(()=>f.store.read()).toThrow(PendingQuoteAmendmentError);}
  if(fault==='get'){f.storage.getItem.mockImplementation(()=>{throw Error('PRIVATE');});expect(()=>f.store.read()).toThrow(PendingQuoteAmendmentError);}
  if(fault==='set'){f.storage.setItem.mockImplementation(()=>{throw Error('PRIVATE');});expect(()=>f.store.write(f.value)).toThrow(PendingQuoteAmendmentError);}
  if(fault==='readback'){f.storage.setItem.mockImplementation(()=>{});expect(()=>f.store.write(f.value)).toThrow(PendingQuoteAmendmentError);}
  if(fault==='remove'||fault==='remove-readback'){f.store.write(f.value);f.storage.removeItem.mockImplementation(()=>{if(fault==='remove')throw Error('PRIVATE');});expect(()=>f.store.clear(f.value)).toThrow(PendingQuoteAmendmentError);expect(f.memory.has(f.key)).toBe(true);}
 });
});
it('keeps simultaneous draft and sharing references in independent slots',()=>{
 const a=fixture('quote.amendment.create'),b=fixture('quote.amendment.send'),send=createPendingQuoteAmendmentStore(a.storage,'quote.amendment.send');a.store.write(a.value);send.write(b.value);
 expect(a.store.read()).toEqual(a.value);send.clear(b.value);expect(a.store.read()).toEqual(a.value);
});
it('rejects unsupported runtime kinds',()=>{
 const f=fixture('quote.amendment.create');expect(()=>createPendingQuoteAmendmentStore(f.storage,'__proto__' as QuoteAmendmentPendingKind)).toThrow(PendingQuoteAmendmentError);
 expect(()=>pendingQuoteAmendment('constructor' as QuoteAmendmentPendingKind,f.value as PendingQuoteAmendment<QuoteAmendmentPendingKind>)).toThrow(PendingQuoteAmendmentError);
});
