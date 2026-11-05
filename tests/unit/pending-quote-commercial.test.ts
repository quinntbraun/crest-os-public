import {randomBytes} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {createPendingQuoteCommercialStore,pendingQuoteCommercial,pendingQuoteCommercialKey} from '../../src/client/pending-quote-commercial';
import {commercialFixture,commercialSend,commercialAccept} from './quote-commercial-fixture';
function fixture(action:'send'|'accept'='send'){
 const f=commercialFixture('Sent'),request=action==='send'?commercialSend(f):commercialAccept(f),common={operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,familyId:request.familyId,revisionId:request.revisionId,expectedFamilyVersion:request.expectedFamilyVersion,expectedRevisionVersion:request.expectedRevisionVersion,expectedContentVersion:request.expectedContentVersion},record=pendingQuoteCommercial({schemaVersion:1,businessId:f.f.business,binding:randomBytes(32).toString('base64url'),reference:'sendId'in request?{...common,action:'send',sendId:request.sendId,approvalId:request.approvalId}:{...common,action:'accept',acceptanceId:request.acceptanceId,agreementId:request.agreementId}});
 const memory=new Map<string,string>(),storage={getItem:vi.fn((key:string)=>memory.get(key)??null),setItem:vi.fn((key:string,value:string)=>{memory.set(key,value);}),removeItem:vi.fn((key:string)=>{memory.delete(key);})},store=createPendingQuoteCommercialStore(storage);return {record,memory,storage,store};
}
it.each(['send','accept'] as const)('persists exactly ten opaque %s reference fields without quote/customer/evidence/hash data',action=>{
 const f=fixture(action);f.store.write(f.record);const raw=f.memory.get(pendingQuoteCommercialKey)!;expect(f.store.read()).toEqual(f.record);expect(Object.keys(JSON.parse(raw).reference)).toHaveLength(10);for(const forbidden of ['body','expectedHash','presentationHash','evidenceNote','amount','recipient','customerId','PRIVATE'])expect(raw).not.toContain(forbidden);expect(Object.isFrozen(f.record.reference)).toBe(true);f.store.require(f.record);f.store.clear(f.record);expect(f.memory.size).toBe(0);
});
it('refuses overwrite and clears only exactly acknowledged metadata',()=>{
 const f=fixture();f.store.write(f.record);expect(()=>f.store.write(f.record)).toThrow();const other=fixture().record;expect(()=>f.store.clear(other)).toThrow();expect(f.store.read()).toEqual(f.record);f.storage.removeItem.mockImplementation(()=>{});expect(()=>f.store.clear(f.record)).toThrow();expect(f.store.read()).toEqual(f.record);
});
it('refuses private additions, malformed action variants, getters and failed read-back acknowledgments',()=>{
 const f=fixture();for(const reference of [{...f.record.reference,expectedHash:'a'.repeat(64)},{...f.record.reference,action:'replace'},{...f.record.reference,expectedContentVersion:'99'},{...f.record.reference,acceptanceId:f.record.reference.operationId}])expect(()=>pendingQuoteCommercial({...f.record,reference})).toThrow();
 const getter=vi.fn(()=>f.record.reference);expect(()=>pendingQuoteCommercial(Object.defineProperty({...f.record},'reference',{enumerable:true,get:getter}))).toThrow();expect(getter).not.toHaveBeenCalled();
 f.storage.setItem.mockImplementation(()=>{});expect(()=>f.store.write(f.record)).toThrow();expect(f.store.read()).toBeNull();
});
