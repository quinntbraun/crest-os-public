import {expect,it} from 'vitest';
import {originalExportFixture} from '../support/original-export-fixture';
import {parseOriginalExportInventory,originalExportHash} from '../../src/client/source-export-originals';
function fixture(billId:string|null=null){
 const f=originalExportFixture(2),value={...f.value,attachments:f.value.attachments.map(item=>item.kind==='supplier_document'?{...item,sourceTable:'crest.opening_document_intents',references:{billId,billRevision:null,documentReference:'Fictional opening statement'}}:item)},bytes=new TextEncoder().encode(JSON.stringify(value)+'\n');return{...f,bytes,header:{...f.header,sourceSchemaVersion:142 as const}};
}
it('parses the opening source variant only in the explicit142 inventory',async()=>{
 const f=fixture(),parsed=await parseOriginalExportInventory(f.bytes,f.header,await originalExportHash(f.bytes),new AbortController().signal);expect(parsed.files).toHaveLength(2);expect(parsed.pendingCount).toBe(1);expect(parsed.files.find(file=>file.kind==='supplier_document')!.sha256).toBe(f.value.attachments[1]!.original!.sha256);
 await expect(parseOriginalExportInventory(f.bytes,{...f.header,sourceSchemaVersion:141},await originalExportHash(f.bytes),new AbortController().signal)).rejects.toThrow();
});
it('refuses an invented bill link on an opening-source original',async()=>{
 const f=fixture('11111111-1111-4111-8111-111111111111');await expect(parseOriginalExportInventory(f.bytes,f.header,await originalExportHash(f.bytes),new AbortController().signal)).rejects.toThrow();
});
