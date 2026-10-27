import {randomUUID,createHash} from 'node:crypto';
export const journalDigest=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
// Independent small source and wire fixture. Relationships across journal rows
// are deliberately not asserted by this snapshot-byte collector.
export function journalCollectionFixture(businessId:string=randomUUID(),observedAt='2026-10-26T00:00:00.123456+00:00',text=' {"original":"é😀é"}\r\n',kind:'snapshot'|'completion'='snapshot'){
 const recordKey=randomUUID(),actor=randomUUID(),operation=randomUUID(),token='d'.repeat(64),stamp='2026-10-26T00:00:00.123456Z',bytes=Buffer.from(text),digest=journalDigest(bytes),size=524288;
 const row:Record<string,unknown>={business_id:businessId,generation_id:recordKey,export_job_id:randomUUID(),lease_id:randomUUID(),actor_id:actor,recovery_epoch:randomUUID(),plan_sha256:'b'.repeat(64),request_sha256:digest,file_count:2,total_bytes:16,manifest_sha256:'c'.repeat(64),created_at:stamp,created_by:actor,origin:'manual',operation_id:operation,import_row_id:null,...(kind==='snapshot'?{app_release_id:'a'.repeat(40),source_schema_version:43,observed_at:stamp}:{expected_version:'9007199254740993',completed_at:stamp,expires_at:'2026-11-02T00:00:00.123456Z'})};
 const descriptor={column:'request_text',bytes:bytes.length,sha256:digest,chunkBytes:size,chunks:Math.ceil(bytes.length/size)};
 const body={schemaVersion:1,scope:'source_export_journal',kind,businessId,recordKey,row,originalText:descriptor};
 const page=()=>{const canonical_evidence=JSON.stringify(body);return {record_key:recordKey,canonical_evidence,evidence_hash:journalDigest(canonical_evidence)};};
 const chunks=Array.from({length:descriptor.chunks},(_,i)=>{const piece=bytes.subarray(i*size,(i+1)*size);return {schemaVersion:1,scope:'source_export_journal',businessId,snapshotToken:token,kind,recordKey,column:'request_text',textBytes:bytes.length,textSha256:digest,chunkIndex:i,chunkCount:descriptor.chunks,offsetBytes:i*size,bytes:piece.length,sha256:journalDigest(piece),encoding:'base64',data:piece.toString('base64')};});
 const context={schemaVersion:1,scope:'source_export_journal',businessId,snapshotToken:token,observedAt,recordCounts:{job:'0',attempt:'0',snapshot:kind==='snapshot'?'1':'0',intent:'0',verification:'0',completion:kind==='completion'?'1':'0'},originalTextBytes:String(bytes.length)};
 const input=()=>({rawContext:JSON.stringify(context),businessId,observedAt,generationId:randomUUID(),remainingMetadataBytes:8388608,remainingRecords:10000});
 async function query(sql:string,args:unknown[]){
  if(sql.includes('source_export_journal_page('))return {rows:args[2]===kind&&args[3]===null?[page()]:[]};
  if(sql.includes('source_export_journal_text_chunk('))return {rows:[{chunk:' '+JSON.stringify(chunks[Number(args[4])])+'\n'}]};
  throw Error('Unexpected synthetic query');
 }
 return{businessId,observedAt,recordKey,token,row,body,page,chunks,context,input,query,text};
}
