import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {formatCurrentSourceLogicalFiles} from '../../src/security/current-source-logical-files';
import {readCurrentSourceLogicalFiles} from '../../src/client/current-source-logical-files';
const binding=()=>({businessId:randomUUID(),generationId:randomUUID(),appReleaseId:'a'.repeat(40),sourceSchemaVersion:134 as const}),stamp='2026-11-22T20:00:00.000000+00:00',signal=()=>new AbortController().signal;
it('reconstructs exact binary and UTF8 files across the physical-part boundary',async()=>{
 const scope=binding(),inputs=[{name:'records.csv',bytes:Buffer.from('"value"\r\n"'+('x'.repeat(4194290))+'🧽'.repeat(12)+'"\r\n')},{name:'business_records.xlsx',bytes:Uint8Array.from([0,255,1,254,3,8,9,10])}];
 const formatted=await formatCurrentSourceLogicalFiles(inputs,scope,stamp,signal()),parts=formatted.parts.map(part=>({name:part.name,bytes:Buffer.from(part.content)}));
 expect(parts.length).toBeGreaterThan(inputs.length);
 const decoded=await readCurrentSourceLogicalFiles(formatted.manifest,parts,scope,signal());expect(decoded).toHaveLength(inputs.length);for(const [index,file]of decoded.entries()){expect(file.name).toBe(inputs[index]!.name);expect(Buffer.from(file.bytes).equals(inputs[index]!.bytes)).toBe(true);}
 expect(decoded[1]!.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
it('refuses wrong scope, missing/extra/corrupt parts, duplicate JSON fields and unsupported logical paths',async()=>{
 const scope=binding(),formatted=await formatCurrentSourceLogicalFiles([{name:'records.csv',bytes:Buffer.from('"header"\r\n')}],scope,stamp,signal()),parts=formatted.parts.map(part=>({name:part.name,bytes:Buffer.from(part.content)}));
 const bad=[...parts];bad[0]={...bad[0]!,bytes:Buffer.from('corrupt')};
 for(const supplied of [[],bad,[...parts,{name:'current_file_9999_part_0001.txt',bytes:Buffer.from('extra')}]])await expect(readCurrentSourceLogicalFiles(formatted.manifest,supplied,scope,signal())).rejects.toThrow('CURRENT_SOURCE_LOGICAL_FILES_REVIEW_REQUIRED');
 await expect(readCurrentSourceLogicalFiles(formatted.manifest,parts,{...scope,businessId:randomUUID()},signal())).rejects.toThrow();
 await expect(readCurrentSourceLogicalFiles(formatted.manifest.replace('{','{"profile":"forged",'),parts,scope,signal())).rejects.toThrow();
 await expect(formatCurrentSourceLogicalFiles([{name:'../records.csv',bytes:Buffer.from('text')}],scope,stamp,signal())).rejects.toThrow();
 const stopped=new AbortController();stopped.abort();await expect(readCurrentSourceLogicalFiles(formatted.manifest,parts,scope,stopped.signal)).rejects.toThrow();
});
