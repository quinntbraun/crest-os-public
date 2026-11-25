import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parseOpeningDocumentRecord,createOpeningDocumentWorkflow} from '../../src/bookkeeping/opening-document-workflow.ts';
import {imageValidationVersion} from '../../src/files/validation-contract.ts';
import {parseOpeningDocumentReserve} from '../../src/bookkeeping/opening-document-contract.ts';
import {createOpeningDocumentDirectory,createOpeningDocumentDispatcher} from '../../src/bookkeeping/opening-document-directory.ts';
function fixture(){
 const businessId=randomUUID(),documentId=randomUUID(),dispatchId=randomUUID(),sha256='a'.repeat(64),reservation={businessId,documentId,reference:'Fictional original supplier bill',sha256,recoveryEpoch:randomUUID(),declaredType:'image/png',byteSize:100,dispatchId,stagingKey:`staging/${businessId}/${documentId}/${dispatchId}`,originalKey:`originals/${businessId}/${documentId}`,previewKey:`previews/${businessId}/${documentId}`};
 const candidate={status:'PrivateValidatedCandidate',validationVersion:imageValidationVersion,source:{sha256,byteSize:100,detectedType:'image/png',width:1,height:1},original:{key:reservation.originalKey,sha256,byteSize:100},preview:{key:reservation.previewKey,sha256:'b'.repeat(64),byteSize:20,contentType:'image/jpeg',width:1,height:1}};
 return {businessId,documentId,reservation,candidate,record:{state:'ready',schemaVersion:1,reservation,candidate}};
}
it('binds an opening reference to the same verified bytes without a supplier bill or expense parent',()=>{
 const f=fixture(),record=parseOpeningDocumentRecord(f.record,f.businessId,f.documentId);
 expect(record.evidence).toEqual({reference:f.reservation.reference,sha256:f.reservation.sha256});expect(record.reservation.expenseId).toBe(f.documentId);expect(record.reservation.expenseRevision).toBe('1');expect(Object.isFrozen(record)).toBe(true);expect(Object.isFrozen(record.evidence)).toBe(true);
});
it.each(['fingerprint','business','document','key','media','size','reference','extra'])('refuses %s substitution in opening-document metadata',change=>{
 const f=fixture();if(change==='fingerprint')f.record.reservation.sha256='c'.repeat(64);if(change==='business')f.record.reservation.businessId=randomUUID();if(change==='document')f.record.reservation.documentId=randomUUID();if(change==='key')f.record.candidate.original.key='originals/'+f.businessId+'/'+randomUUID();if(change==='media')f.record.candidate.source.detectedType='image/jpeg';if(change==='size')f.record.candidate.source.byteSize++;if(change==='reference')f.record.reservation.reference=' '+f.record.reservation.reference;if(change==='extra')Object.assign(f.record,{approved:true});
 expect(()=>parseOpeningDocumentRecord(f.record,f.businessId,f.documentId)).toThrow();
});
it('preserves a pending reservation without claiming original availability',()=>{
 const f=fixture(),record=parseOpeningDocumentRecord({...f.record,candidate:null},f.businessId,f.documentId);expect(record.candidate).toBeNull();expect(record.evidence.sha256).toBe(f.reservation.sha256);
});
it('returns a genuinely published original on retry without redispatching bytes or publication',async()=>{
 const f=fixture(),read=vi.fn(async()=>f.record),publish=vi.fn(),authorizeWrite=vi.fn();const flow=createOpeningDocumentWorkflow({read,publish,authorizeWrite},{} as never,{} as never);
 const result=await flow.prepareAndPublish('synthetic',f.businessId,f.documentId,randomUUID(),new AbortController().signal);expect(result.candidate).toEqual(f.candidate);expect(publish).not.toHaveBeenCalled();expect(authorizeWrite).not.toHaveBeenCalled();
});
it('accepts only a bounded typed reservation and never a client-provided key or validation result',()=>{
 const f=fixture(),input={documentId:f.documentId,operationId:randomUUID(),recoveryEpoch:f.reservation.recoveryEpoch,reference:f.reservation.reference,sha256:f.reservation.sha256,contentType:'image/png',byteSize:26214400};expect(Object.isFrozen(parseOpeningDocumentReserve(input))).toBe(true);
 for(const bad of[{...input,byteSize:26214401},{...input,byteSize:0},{...input,byteSize:1.5},{...input,contentType:'text/html'},{...input,stagingKey:f.reservation.stagingKey},{...input,candidate:f.candidate},{...input,sha256:'invalid'}])expect(()=>parseOpeningDocumentReserve(bad)).toThrow('OPENING_DOCUMENT_INPUT_REQUIRED');
});
it('keeps the unregistered adapter closed in production before any database or decoder dispatch',()=>{
 const config={environment:'production' as const,businessId:randomUUID(),connectionString:'postgresql://web:synthetic@database.example.test/crest'};
 expect(()=>createOpeningDocumentDirectory(config,{} as never,{} as never,'postgresql://finance:synthetic@database.example.test/crest')).toThrow('OPENING_DOCUMENT_AUTHORITY_REQUIRED');
 expect(()=>createOpeningDocumentDispatcher(config,{} as never,{} as never,'postgresql://worker:synthetic@database.example.test/crest',{} as never,{} as never)).toThrow('OPENING_DOCUMENT_AUTHORITY_REQUIRED');
});
it('requires a separate worker login on the same database before constructing its dispatch port',()=>{
 const config={environment:'test' as const,businessId:randomUUID(),connectionString:'postgresql://web:synthetic@database.example.test/crest'};
 for(const worker of[config.connectionString,'postgresql://worker:synthetic@other.example.test/crest','postgresql://worker:synthetic@database.example.test/other'])expect(()=>createOpeningDocumentDispatcher(config,{} as never,{} as never,worker,{} as never,{} as never)).toThrow('OPENING_DOCUMENT_AUTHORITY_REQUIRED');
});
