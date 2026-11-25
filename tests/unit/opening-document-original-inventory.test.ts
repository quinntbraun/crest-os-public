import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {collectOpeningDocumentOriginalInventory} from '../../src/tooling/opening-document-original-inventory.ts';
import type {RecoveryBackupSnapshot} from '../../src/tooling/recovery-backup-lease.ts';
import {imageValidationVersion} from '../../src/files/validation-contract.ts';
function fixture(){
 const business_id=randomUUID(),id=randomUUID(),sha256='a'.repeat(64),intent={id,business_id,dispatch_id:randomUUID(),expected_sha256:sha256,reference:'Fictional opening original',recovery_epoch:randomUUID(),media_type:'image/png',byte_size:100};
 const candidate={status:'PrivateValidatedCandidate',validationVersion:imageValidationVersion,source:{sha256,byteSize:100,detectedType:'image/png',width:1,height:1},original:{key:`originals/${business_id}/${id}`,sha256,byteSize:100},preview:{key:`previews/${business_id}/${id}`,sha256:'b'.repeat(64),byteSize:20,contentType:'image/jpeg',width:1,height:1}};
 return {intent,original:{business_id,id,candidate}};
}
function reader(rows:unknown[],orphan=false){
 let fetched=false;const calls:string[]=[];
 const query:RecoveryBackupSnapshot['query']=async sql=>{calls.push(sql);return {rows:sql.startsWith('SELECT')?[{orphan}]:sql.startsWith('FETCH')&&!fetched?(fetched=true,rows):[],command:'SELECT',rowCount:0,oid:0,fields:[]};};
 return {query,calls};
}
it('retains truthful opening-source identity and distinguishes pending bytes',async()=>{
 const f=fixture(),pending=fixture(),r=reader([f,{...pending,original:null}]),object=vi.fn(),staging=vi.fn();
 expect(await collectOpeningDocumentOriginalInventory(r.query,new AbortController().signal,{object,staging})).toEqual({records:2,objects:2,pending:1,originalBytesIncluded:false,completeBackup:false});
 expect(object.mock.calls.map(([row])=>[row.sourceTable,row.sourceIdentity,row.domain,row.variant])).toEqual([['crest.opening_document_originals',f.intent.id,'supplier_document','original'],['crest.opening_document_originals',f.intent.id,'supplier_document','preview']]);
 expect(staging.mock.calls.map(([row])=>[row.publication,row.bytesVerified])).toEqual([['published',false],['pending',false]]);expect(r.calls.at(-1)).toBe('CLOSE crest_opening_document_originals');
});
it.each(['hash','business','id','key','missing-candidate','duplicate'])('refuses %s drift and closes the cursor',async change=>{
 const f=fixture();if(change==='hash')f.intent.expected_sha256='c'.repeat(64);if(change==='business')f.original.business_id=randomUUID();if(change==='id')f.original.id=randomUUID();if(change==='key')f.original.candidate.original.key=`originals/${f.intent.business_id}/${randomUUID()}`;
 const row=change==='missing-candidate'?{...f,original:{...f.original,candidate:null}}:f,r=reader(change==='duplicate'?[row,row]:[row]);
 await expect(collectOpeningDocumentOriginalInventory(r.query,new AbortController().signal,{object:vi.fn(),staging:vi.fn()})).rejects.toThrow('OPENING_DOCUMENT_INVENTORY_REVIEW_REQUIRED');expect(r.calls.at(-1)).toBe('CLOSE crest_opening_document_originals');
});
it('refuses orphan publications before reading files',async()=>{
 const r=reader([],true),object=vi.fn();await expect(collectOpeningDocumentOriginalInventory(r.query,new AbortController().signal,{object,staging:vi.fn()})).rejects.toThrow();expect(object).not.toHaveBeenCalled();expect(r.calls).toHaveLength(1);
});
it('closes the cursor when cancellation occurs during a consumer',async()=>{
 const r=reader([fixture(),fixture()]),controller=new AbortController(),object=vi.fn(()=>controller.abort());
 await expect(collectOpeningDocumentOriginalInventory(r.query,controller.signal,{object,staging:vi.fn()})).rejects.toThrow();expect(r.calls.at(-1)).toBe('CLOSE crest_opening_document_originals');
});
