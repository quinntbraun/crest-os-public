import {expect,it,vi} from 'vitest';
import {createSourceExportDownloadController} from '../../src/client/source-export-download-controller';
import {originalExportFixture} from '../support/original-export-fixture';
import type {createSourceExportDownloadClient} from '../../src/client/source-export-downloads';
import type {createCurrentSourceFileReader} from '../../src/client/current-source-file-reader';
function fixture(){
 const f=originalExportFixture(),proof={csrfToken:'a'.repeat(43),expiresAt:Date.now()+60000},context={schemaVersion:1 as const,businessId:f.businessId,actorId:f.actorId,appReleaseId:f.header.appReleaseId,profile:'crest.current-business-source-bundle.v1' as const,sourceSchemaVersion:136 as const,writeState:'ready' as const,recoveryEpoch:f.epoch},readContext=vi.fn(async()=>context),blobs:Blob[]=[],click=vi.fn(),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{if(!(blob instanceof Blob))throw Error();blobs.push(blob);return 'blob:original-controller-'+blobs.length;});vi.stubGlobal('document',{body:{append:vi.fn()},createElement:()=>({click,remove:vi.fn()})});
 const fetch=vi.fn<typeof globalThis.fetch>(async(_url,request)=>{const input=JSON.parse(request!.body as string),a=f.value.attachments.find(item=>item.attachmentId===input.attachmentId)!,bytes=f.contents.get(a.attachmentId)!;return new Response(bytes.slice(),{headers:{'content-type':'image/png','content-length':String(bytes.length),'x-crest-sha256':a.original!.sha256,'content-disposition':`attachment; filename="receipt-${a.attachmentId}.png"`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});});vi.stubGlobal('fetch',fetch);
 type Api=ReturnType<typeof createSourceExportDownloadClient>;const api={catalogue:vi.fn<Api['catalogue']>().mockResolvedValueOnce({...f.header,files:f.files.slice(0,5),nextOrdinal:5}).mockResolvedValue({...f.header,files:f.files.slice(5),nextOrdinal:null}),receive:vi.fn<Api['receive']>(),toJSON():never{throw Error();}};
 type Logical=ReturnType<typeof createCurrentSourceFileReader>;const logical={list:vi.fn<Logical['list']>(),receive:vi.fn<Logical['receive']>(async(_name,fresh,signal,consume)=>{await fresh(signal);const bytes=f.bytes.slice();try{await consume({header:f.header,logicalFile:{fileName:'attachment_inventory.json',contentType:'application/json',bytes:bytes.length,sha256:f.sha256},bytes},signal,proof.expiresAt);}finally{bytes.fill(0);}}),dispose:vi.fn()};
 const denied=vi.fn(),c=createSourceExportDownloadController({jobId:f.jobId,change:vi.fn(),session:async()=>proof,context:readContext,api:()=>api,logical:()=>logical,onAccessDenied:denied});return{...f,c,context,readContext,logical,blobs,click,revoke,fetch,denied};
}
it('composes verified inventory, fresh original downloads, bounded ZIP save and offline resume; clears private state on return',async()=>{
 const f=fixture();try{
  await f.c.load();expect(f.c.view().originals).toMatchObject({supported:true,loaded:false});await f.c.listOriginals();expect(f.c.view().originals).toMatchObject({loaded:true,originalCount:3,pendingCount:1,batches:[{ordinal:1,fileCount:3,comparison:'unchecked'}]});
  await f.c.prepareOriginalBatch(1);expect(f.fetch).toHaveBeenCalledTimes(3);expect(f.c.view()).toMatchObject({phase:'prepared',canRequestSave:true,prepared:{fileName:f.c.view().originals!.batches[0]!.fileName}});expect(f.click).not.toHaveBeenCalled();f.c.requestSave();expect(f.click).toHaveBeenCalledOnce();
  const file=new File([await f.blobs[0]!.arrayBuffer()],f.c.view().originals!.batches[0]!.fileName);await f.c.compareOriginalBatches([file]);expect(f.c.view().originals!.batches[0]!.comparison).toBe('matching');expect(f.c.view().canRequestSave).toBe(false);expect(f.revoke).toHaveBeenCalledWith('blob:original-controller-1');
  f.c.reviewOnReturn();expect(f.c.view()).toMatchObject({phase:'review',files:[],prepared:null,originals:{supported:false,loaded:false,batches:[]}});expect(f.logical.dispose).toHaveBeenCalledOnce();
 }finally{f.c.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
it('refuses original bytes when the current principal changes after loading the inventory',async()=>{
 const f=fixture();try{await f.c.load();await f.c.listOriginals();f.readContext.mockResolvedValueOnce({...f.context,actorId:'00000000-0000-4000-8000-000000000001'});await f.c.prepareOriginalBatch(1);expect(f.fetch).not.toHaveBeenCalled();expect(f.denied).toHaveBeenCalledOnce();expect(f.c.view()).toMatchObject({phase:'unavailable',prepared:null,originals:{batches:[]}});}finally{f.c.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
