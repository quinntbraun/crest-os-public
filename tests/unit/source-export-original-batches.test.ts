import {expect,it,vi} from 'vitest';
import {zipSync,unzipSync} from 'fflate';
import {parseOriginalExportInventory,downloadExportOriginal,originalExportHash} from '../../src/client/source-export-originals';
import {createOriginalExportBatchReader,originalExportBatches} from '../../src/client/source-export-original-batches';
import {originalExportFixture} from '../support/original-export-fixture';
const signal=()=>new AbortController().signal,proof=()=>({csrfToken:'a'.repeat(43),expiresAt:Date.now()+60000});
async function setup(count=3){const f=originalExportFixture(count),inventory=await parseOriginalExportInventory(f.bytes,f.header,f.sha256,signal()),copies:Uint8Array[]=[];const receive=vi.fn<typeof downloadExportOriginal>(async(_index,file)=>{const bytes=f.contents.get(file.attachmentId)!.slice();copies.push(bytes);return bytes;});return{...f,inventory,copies,receive,reader:createOriginalExportBatchReader(inventory,receive)};}
it('prepares a deterministic ZIP containing all three exact originals and an index bound to the selected export, then verifies a saved copy offline',async()=>{
 const f=await setup(),fresh=vi.fn(async()=>proof());let saved:File|undefined;
 await f.reader.receive(1,fresh,signal(),async value=>{const entries=unzipSync(value.bytes);expect(Object.keys(entries).sort()).toEqual(['original_batch.json',...f.inventory.files.map(file=>file.path)].sort());for(const file of f.inventory.files)expect(entries[file.path]).toEqual(f.contents.get(file.attachmentId));expect(JSON.parse(new TextDecoder().decode(entries['original_batch.json']))).toMatchObject({inventorySha256:f.sha256,batch:1,batchCount:1,originalCount:3,pendingCount:1,completeBackup:false});saved=new File([value.bytes],value.logicalFile.fileName);expect(await originalExportHash(value.bytes)).toBe(value.logicalFile.sha256);});
 expect(f.receive).toHaveBeenCalledTimes(3);expect(fresh).toHaveBeenCalledTimes(4);expect(f.copies.every(bytes=>bytes.every(byte=>byte===0))).toBe(true);
 expect(await f.reader.compare([saved!],signal())).toEqual({batches:[{ordinal:1,state:'matching'}],extraCount:0});
});
it('splits batches by count and byte bounds and keeps absent reservations out of the archive plan',async()=>{
 const f=await setup(26);expect(f.reader.batches.map(batch=>batch.files.length)).toEqual([25,1]);expect(f.inventory.files).toHaveLength(26);const large={...f.inventory,files:f.inventory.files.slice(0,3).map(file=>({...file,byteSize:20000000}))};expect(originalExportBatches(large).map(batch=>batch.originalBytes)).toEqual([20000000,20000000,20000000]);
});
it.each(['original','metadata','extra','missing','duplicate selection','foreign generation'])('refuses %s archive corruption without reporting a recovered original',async issue=>{
 const f=await setup();let archive:Uint8Array<ArrayBuffer>|undefined;await f.reader.receive(1,async()=>proof(),signal(),async value=>{archive=value.bytes.slice();});
 const entries=unzipSync(archive!);if(issue==='original')entries[f.inventory.files[0]!.path]![0]=entries[f.inventory.files[0]!.path]![0]!^1;if(issue==='metadata')entries['original_batch.json']![0]=entries['original_batch.json']![0]!^1;if(issue==='extra')entries['unrelated.txt']=new Uint8Array([1]);if(issue==='missing')delete entries[f.inventory.files[0]!.path];if(issue==='foreign generation'){const m=JSON.parse(new TextDecoder().decode(entries['original_batch.json']));m.header.generationId='00000000-0000-4000-8000-000000000001';entries['original_batch.json']=new TextEncoder().encode(JSON.stringify(m)+'\n');}
 const file=new File([new Uint8Array(zipSync(entries,{level:0}))],f.reader.batches[0]!.fileName);expect((await f.reader.compare(issue==='duplicate selection'?[file,file]:[file],signal())).batches).toEqual([{ordinal:1,state:'invalid'}]);
});
it('resumes by comparing selected local ZIPs and marks only absent batches for another download without reading unrelated files',async()=>{
 const f=await setup(26);let saved:File|undefined;await f.reader.receive(1,async()=>proof(),signal(),async value=>{saved=new File([value.bytes],value.logicalFile.fileName);});const unrelated=new File(['private contents'],'unrelated.txt'),read=vi.spyOn(unrelated,'arrayBuffer');expect(await f.reader.compare([saved!,unrelated],signal())).toEqual({batches:[{ordinal:1,state:'matching'},{ordinal:2,state:'missing'}],extraCount:1});expect(read).not.toHaveBeenCalled();
});
it('clears partially retrieved originals after cancellation and releases no ZIP',async()=>{
 const f=await setup(),c=new AbortController(),consume=vi.fn();f.receive.mockImplementationOnce(async(_index,file)=>{const copy=f.contents.get(file.attachmentId)!.slice();f.copies.push(copy);c.abort();return copy;});await expect(f.reader.receive(1,async()=>proof(),c.signal,consume)).rejects.toThrow();expect(consume).not.toHaveBeenCalled();expect(f.copies.every(bytes=>bytes.every(byte=>byte===0))).toBe(true);
});
it.each(['hash','duplicate keys','scope','path','photo object','counts'])('rejects %s inventory inconsistency before any network request',async issue=>{
 const f=originalExportFixture();if(issue==='scope')f.value.businessId='00000000-0000-4000-8000-000000000001';if(issue==='path')f.value.attachments[0]!.original!.path='../private.png';if(issue==='photo object'){const photo=f.value.attachments.find(item=>item.kind==='condition_photo')!;photo.original!.mediaType='application/pdf';photo.original!.path=photo.original!.path.replace('.png','.pdf');}if(issue==='counts')f.value.availableCount++;
 const text=JSON.stringify(f.value)+'\n',bytes=new TextEncoder().encode(issue==='duplicate keys'?text.replace('{','{"schemaVersion":1,'):text),hash=await originalExportHash(bytes);await expect(parseOriginalExportInventory(bytes,f.header,issue==='hash'?'0'.repeat(64):hash,signal())).rejects.toThrow();
});
it('downloads a fixed original reference, checks its expected bytes and refuses a forged wire identity',async()=>{
 const f=await setup(),file=f.inventory.files[0]!,content=f.contents.get(file.attachmentId)!;let disposition=`receipt-${file.attachmentId}.png`;
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(content.slice(),{headers:{'content-type':'image/png','content-length':String(content.length),'x-crest-sha256':file.sha256,'content-disposition':`attachment; filename="${disposition}"`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}}));vi.stubGlobal('fetch',fetch);
 try{const bytes=await downloadExportOriginal(f.inventory,file,proof(),signal());expect(bytes).toEqual(content);bytes.fill(0);expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({exportJobId:f.jobId,generationId:f.generationId,kind:file.kind,attachmentId:file.attachmentId});disposition='receipt-00000000-0000-4000-8000-000000000001.png';await expect(downloadExportOriginal(f.inventory,file,proof(),signal())).rejects.toThrow();}finally{vi.unstubAllGlobals();}
});

