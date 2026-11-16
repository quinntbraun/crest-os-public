import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {downloadLegacyContactImport} from '../../src/client/legacy-contact-download.ts';
import {legacyContactArchiveFilename} from '../../src/customer/legacy-contact-download-contract.ts';

const id=(n:number)=>'123e4567-e89b-42d3-a456-'+String(n).padStart(12,'0');
const input={batchId:id(1),applicationOperationId:id(2),recoveryEpoch:id(3)};
const proof=()=>({csrfToken:'A'.repeat(43),expiresAt:Date.now()+30000});
const bytes=new Uint8Array([80,75,3,4,19,23]);
const digest=createHash('sha256').update(bytes).digest('hex');
const name=legacyContactArchiveFilename(input.batchId);

function response(body:Uint8Array<ArrayBuffer>,headers:Record<string,string>={}){
 return new Response(body,{headers:{
  'content-type':'application/zip','content-length':String(bytes.byteLength),
  'content-disposition':'attachment; filename="'+name+'"','cache-control':'private, no-store','x-crest-sha256':digest,...headers,
 }});
}
function browser(){
 const element={href:'',download:'',click:vi.fn(),remove:vi.fn()};
 const create=vi.fn(()=> 'blob:private-test'),revoke=vi.fn();
 vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:revoke});
 vi.stubGlobal('document',{createElement:vi.fn(()=>element),body:{append:vi.fn()}});
 vi.stubGlobal('window',{setTimeout:vi.fn((callback:()=>void)=>callback())});
 return {element,create,revoke};
}
describe('contact import browser download',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('saves only after checking the archive and exact batch filename',async()=>{
  const {element,create,revoke}=browser();
  const fetch=vi.fn(async()=>response(bytes));
  vi.stubGlobal('fetch',fetch);
  await downloadLegacyContactImport(input,proof(),new AbortController().signal);
  expect(fetch).toHaveBeenCalledWith('/api/business/customers/legacy-batches/download',
   expect.objectContaining({method:'POST',credentials:'same-origin',body:JSON.stringify(input)}));
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  expect(element.download).toBe(name);
  expect(element.click).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:private-test');
 });
 it('does not create a download for mismatched metadata, truncated bytes, or corrupt content',async()=>{
  const {element,create}=browser();
  const fetch=vi.fn().mockResolvedValueOnce(response(bytes,{'x-crest-sha256':'0'.repeat(64)}))
   .mockResolvedValueOnce(response(bytes.slice(0,-1)))
   .mockResolvedValueOnce(response(bytes,{'content-disposition':'attachment; filename="another-batch.zip"'}));
  vi.stubGlobal('fetch',fetch);
  for(let index=0;index<3;index++)
   await expect(downloadLegacyContactImport(input,proof(),new AbortController().signal)).rejects.toThrow('LEGACY_DOWNLOAD_UNAVAILABLE');
  expect(create).not.toHaveBeenCalled();
  expect(element.click).not.toHaveBeenCalled();
 });
});
