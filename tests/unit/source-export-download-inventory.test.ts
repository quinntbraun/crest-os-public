import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sourceExportDownloadFixture} from '../support/source-export-download-fixture.ts';
import {createSourceExportInventoryBuilder,parseSourceExportDownloadInventory} from '../../src/client/source-export-download-inventory.ts';
const error='SOURCE_EXPORT_INVENTORY_REVIEW_REQUIRED';
function fixture(){const f=sourceExportDownloadFixture(),builder=createSourceExportInventoryBuilder(f.businessId,f.jobId);return{...f,builder};}
function complete(){const f=fixture();f.builder.append(f.first);f.builder.append(f.second);return{...f,inventory:f.builder.snapshot().forDownloadInventory()};}
it('assembles only contiguous pinned pages and exposes no complete inventory before the final page',()=>{
 const f=fixture();expect(f.builder.request()).toEqual(f.pageRequest);expect(f.builder.pinnedHeader()).toBeUndefined();expect(()=>f.builder.snapshot()).toThrow(error);
 f.builder.append(f.first);expect(f.builder.progress()).toEqual({loaded:5,total:7,metadataComplete:false});expect(f.builder.request()).toEqual({exportJobId:f.jobId,generationId:f.generationId,afterOrdinal:5});expect(f.builder.pinnedHeader()).toEqual(f.header);
 f.builder.append(f.second);expect(f.builder.request()).toBeNull();expect(f.builder.progress()).toEqual({loaded:7,total:7,metadataComplete:true});const result=f.builder.snapshot();expect(result.forDownloadInventory().files).toEqual(f.files);expect(result.forDownloadInventory()).toMatchObject({assurance:'catalogue_consistency_only',completePortableExport:false,completeBackup:false});expect(Object.isFrozen(result.forDownloadInventory().files)).toBe(true);expect(()=>JSON.stringify(result)).toThrow(error);expect(()=>JSON.stringify(f.builder)).toThrow(error);
});
it.each(['business','job','generation','release','manifest','totals'])('refuses changed %s on a later page without poisoning prior progress',issue=>{
 const f=fixture();f.builder.append(f.first);const page=structuredClone(f.second);if(issue==='business')page.businessId=randomUUID();if(issue==='job')page.exportJobId=randomUUID();if(issue==='generation')page.generationId=randomUUID();if(issue==='release')page.appReleaseId='b'.repeat(40);if(issue==='manifest')page.manifestSha256='e'.repeat(64);if(issue==='totals')page.totalBytes++;
 expect(()=>f.builder.append(page)).toThrow(error);expect(f.builder.progress()).toEqual({loaded:5,total:7,metadataComplete:false});f.builder.append(f.second);expect(f.builder.snapshot().forDownloadInventory().files.length).toBe(7);
});
it.each(['name','part'])('detects a duplicate %s across separate pages',issue=>{const f=fixture();f.builder.append(f.first);const tail=structuredClone(f.second);if(issue==='name')tail.files[0]!.fileName=f.files[0]!.fileName;else tail.files[0]!.partId=f.files[0]!.partId;expect(()=>f.builder.append(tail)).toThrow(error);expect(f.builder.request()!.afterOrdinal).toBe(5);});
it.each(['ordering','early manifest','wrong manifest hash','under total','over total'])('rejects %s evidence before completion',issue=>{
 const f=fixture(),first=structuredClone(f.first),last=structuredClone(f.second);
 if(issue==='ordering'){const name=first.files[0]!.fileName;first.files[0]!.fileName=first.files[1]!.fileName;first.files[1]!.fileName=name;}
 if(issue==='early manifest'){first.files[1]!.fileName='source_manifest.json';first.files[1]!.contentType='application/json';}
 if(issue==='wrong manifest hash')last.files[1]!.sha256='e'.repeat(64);
 if(issue==='under total')last.files[0]!.bytes--;
 if(issue==='over total')last.files[0]!.bytes++;
 if(issue==='ordering'||issue==='early manifest'){expect(()=>f.builder.append(first)).toThrow(error);expect(f.builder.progress().loaded).toBe(0);}else{f.builder.append(first);expect(()=>f.builder.append(last)).toThrow(error);expect(f.builder.progress().metadataComplete).toBe(false);}
});
it('rejects a partial page whose remaining byte budget cannot contain its remaining files',()=>{const f=fixture(),p=structuredClone(f.first);p.files[0]!.bytes+=63;expect(()=>f.builder.append(p)).toThrow(error);expect(f.builder.progress().loaded).toBe(0);});
it('does not accept a repeated page or append after completion',()=>{const f=fixture();f.builder.append(f.first);expect(()=>f.builder.append(f.first)).toThrow(error);f.builder.append(f.second);expect(()=>f.builder.append(f.second)).toThrow(error);expect(f.builder.progress().metadataComplete).toBe(true);});
it('copies incoming metadata before exposing its pinned state',()=>{const f=fixture(),page=structuredClone(f.first);f.builder.append(page);page.files[0]!.fileName='changed.txt';page.manifestSha256='e'.repeat(64);f.builder.append(f.second);expect(f.builder.snapshot().forDownloadInventory().files[0]!.fileName).toBe(f.files[0]!.fileName);expect(f.builder.pinnedHeader()).toEqual(f.header);});
it.each(['sparse','extra','getter'])('refuses %s inventory arrays without evaluating a getter',issue=>{
 const f=complete(),files=[...f.inventory.files],read=vi.fn(()=>f.inventory.files[0]);if(issue==='sparse')delete files[0];if(issue==='extra')Object.assign(files,{unknown:true});if(issue==='getter')Object.defineProperty(files,'0',{enumerable:true,get:read});
 expect(()=>parseSourceExportDownloadInventory({...f.inventory,files},f.businessId)).toThrow(error);expect(read).not.toHaveBeenCalled();
});
it.each(['backup claim','portable claim','assurance','extra field','wrong scope'])('refuses an unsupported %s in imported inventory data',issue=>{
 const f=complete(),value={...f.inventory};if(issue==='backup claim')Object.assign(value,{completeBackup:true});if(issue==='portable claim')Object.assign(value,{completePortableExport:true});if(issue==='assurance')Object.assign(value,{assurance:'trusted_server_authority'});if(issue==='extra field')Object.assign(value,{credential:'PRIVATE'});expect(()=>parseSourceExportDownloadInventory(value,issue==='wrong scope'?randomUUID():f.businessId)).toThrow(error);
});
it('allows an expired inventory to compare existing bytes without granting live download authority',()=>{const f=complete(),completedAt=new Date(Date.now()-8*86400000).toISOString().replace('Z','000Z'),expiresAt=new Date(Date.parse(completedAt)+604800000).toISOString().replace('Z','000Z'),value=parseSourceExportDownloadInventory({...f.inventory,header:{...f.header,completedAt,expiresAt}},f.businessId);expect(Date.parse(value.header.expiresAt)).toBeLessThan(Date.now());expect(value.assurance).toBe('catalogue_consistency_only');expect(value.completeBackup).toBe(false);});
it('handles the existing 1024-file limit and rejects an additional file',()=>{
 const f=fixture(),files=Array.from({length:1024},(_,i)=>({ordinal:i+1,partId:randomUUID(),fileName:i===1023?'source_manifest.json':'file_'+String(i).padStart(4,'0')+'.txt',contentType:i===1023?'application/json':'text/plain; charset=utf-8',bytes:1,sha256:i===1023?'f'.repeat(64):'a'.repeat(64)})),h={...f.header,fileCount:1024,totalBytes:1024,manifestSha256:'f'.repeat(64)};
 for(let at=0;at<files.length;at+=5){const end=Math.min(at+5,files.length);f.builder.append({...h,files:files.slice(at,end),nextOrdinal:end<files.length?end:null});}
 const value=f.builder.snapshot().forDownloadInventory();expect(value.files.length).toBe(1024);expect(()=>parseSourceExportDownloadInventory({...value,files:[...value.files,value.files[0]]},f.businessId)).toThrow(error);
});
it('disposes metadata without rebasing or permitting reuse of the builder',()=>{const f=fixture();f.builder.append(f.first);f.builder.dispose();f.builder.dispose();for(const work of [()=>f.builder.request(),()=>f.builder.pinnedHeader(),()=>f.builder.progress(),()=>f.builder.snapshot(),()=>f.builder.append(f.second)])expect(work).toThrow(error);});
