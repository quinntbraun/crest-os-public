import {randomUUID,createHash} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {formatCurrentSourceLogicalFiles} from '../../src/security/current-source-logical-files';
import {createCurrentSourceFileReader} from '../../src/client/current-source-file-reader';
import {parseSourceExportDownloadInventory} from '../../src/client/source-export-download-inventory';
import type {createSourceExportDownloadClient} from '../../src/client/source-export-downloads';
const signal=()=>new AbortController().signal,hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const binding={businessId:randomUUID(),generationId:randomUUID(),appReleaseId:'a'.repeat(40),sourceSchemaVersion:134 as const},binary=Uint8Array.from([0,255,2,253]),formatted=await formatCurrentSourceLogicalFiles([{name:'crest_customers.csv',bytes:Buffer.from('"name"\r\n"Fixture"\r\n')},{name:'business_records.xlsx',bytes:binary}],binding,'2026-11-22T20:00:00.000000+00:00',signal());
 const data=new Map(formatted.parts.map(part=>[part.name,Buffer.from(part.content)]));data.set('source_manifest.json',Buffer.from(formatted.manifest));const names=[...data.keys()].filter(name=>name!=='source_manifest.json').sort().concat('source_manifest.json');
 const files=names.map((name,index)=>({ordinal:index+1,partId:randomUUID(),fileName:name,contentType:name.endsWith('.json')?'application/json':'text/plain; charset=utf-8',bytes:data.get(name)!.length,sha256:hash(data.get(name)!)})),time=Date.now()-1000,micro=(value:number)=>new Date(value).toISOString().replace(/Z$/,'000Z');
 const header={schemaVersion:1,businessId:binding.businessId,exportJobId:randomUUID(),generationId:binding.generationId,appReleaseId:binding.appReleaseId,profile:'crest.current-business-source-bundle.v1',sourceSchemaVersion:134,completedAt:micro(time),expiresAt:micro(time+604800000),fileCount:files.length,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0),manifestSha256:files.at(-1)!.sha256};
 const inventory=parseSourceExportDownloadInventory({formatVersion:1,header,files,assurance:'catalogue_consistency_only',completePortableExport:false,completeBackup:false},binding.businessId),received:string[]=[],fresh=vi.fn(async()=>({csrfToken:'a'.repeat(42)+'A',expiresAt:Date.now()+60000}));
 let corrupt=false;
 const api={catalogue:vi.fn(),receive:vi.fn(async(_header,file,_proof,active,consume)=>{received.push(file.fileName);const bytes=new Uint8Array(data.get(file.fileName)!);if(corrupt&&file.fileName!=='source_manifest.json')bytes[0]=bytes[0]!^1;try{await consume({header:inventory.header,file,bytes},active);}finally{bytes.fill(0);}}),toJSON(){throw Error();}} satisfies ReturnType<typeof createSourceExportDownloadClient>;
 return {inventory,api,binary,received,fresh,corrupt:()=>{corrupt=true;}};
}
it('fetches only the selected workbook parts and clears temporary consumer bytes',async()=>{
 const f=await fixture(),reader=createCurrentSourceFileReader(f.inventory,f.api);let held:Uint8Array|undefined,saved:Uint8Array|undefined;
 await reader.receive('business_records.xlsx',f.fresh,signal(),async file=>{held=file.bytes;saved=file.bytes.slice();expect(file.logicalFile.fileName).toBe('business_records.xlsx');});
 expect(Buffer.from(saved!).equals(f.binary)).toBe(true);expect(held!.every(value=>value===0)).toBe(true);expect(f.received).toEqual(['source_manifest.json','current_file_0002_part_0001.txt']);expect(f.fresh).toHaveBeenCalledTimes(3);
 const listed=await reader.list(f.fresh,signal());expect(listed.map(file=>file.name)).toEqual(['crest_customers.csv','business_records.xlsx']);expect(f.received).toHaveLength(2);reader.dispose();await expect(reader.list(f.fresh,signal())).rejects.toThrow();
});
it('refuses corruption and a failed fresh-authority check before preparing a local file',async()=>{
 const f=await fixture(),reader=createCurrentSourceFileReader(f.inventory,f.api),consume=vi.fn();f.corrupt();await expect(reader.receive('business_records.xlsx',f.fresh,signal(),consume)).rejects.toThrow();expect(consume).not.toHaveBeenCalled();
 const next=await fixture(),nextReader=createCurrentSourceFileReader(next.inventory,next.api);let calls=0;const fresh=async()=>{if(++calls===3)throw Error('Authority changed');return next.fresh();};await expect(nextReader.receive('business_records.xlsx',fresh,signal(),consume)).rejects.toThrow('Authority changed');expect(consume).not.toHaveBeenCalled();
});
