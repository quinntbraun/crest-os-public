import {it,expect} from 'vitest';
import {unzipSync,strFromU8} from 'fflate';
import {buildFulfillmentModeArchive} from '../../src/operations/fulfillment-mode-archive';
import {modeHistoryFixture} from '../fixtures/fulfillment-modes';
it('retrieves exact retained settings with explicit narrow coverage and checksummed parts',async()=>{
 const f=modeHistoryFixture(23),parts=unzipSync(await buildFulfillmentModeArchive(f.businessId,f.versions.at(-1),f.versions)),saved=JSON.parse(strFromU8(parts['saved_history.json']!)),manifest=JSON.parse(strFromU8(parts['manifest.json']!));expect(saved.versions).toEqual(f.versions);expect(saved).toMatchObject({throughSequence:'23',completeCrestExport:false,completeBackup:false,originalHashInputsIncluded:false,unsavedDraftIncluded:false});for(const part of manifest.parts){const bytes=parts[part.name]!;expect(bytes.length).toBe(part.bytes);expect(Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex')).toBe(part.sha256);}expect(strFromU8(parts['service_arrangements.csv']!)).toContain('"\\N"');
});
it('preserves formula-like reasons, multiline text, quotes, null and literal backslashes losslessly',async()=>{
 const f=modeHistoryFixture(3);f.versions[1]={...f.versions[1]!,reason:'  =Synthetic("quoted")\r\n\\N'};f.versions[2]={...f.versions[2]!,reason:"'literal\\path"};const parts=unzipSync(await buildFulfillmentModeArchive(f.businessId,f.versions.at(-1),f.versions)),csv=strFromU8(parts['service_arrangements.csv']!),map=JSON.parse(strFromU8(parts['escape_map.json']!));expect(csv).toContain('"\'  =Synthetic(""quoted"")\r\n\\\\N"');expect(csv).toContain('"\'\'literal\\\\path"');expect(map.escapes).toEqual(f.versions.slice(1).map(row=>({row_id:row.id,column:'reason',apostrophe_prefix:true})));expect(JSON.parse(strFromU8(parts['saved_history.json']!)).versions).toEqual(f.versions);
});
it('refuses missing, duplicate, no-op or mismatched head evidence',async()=>{
 const f=modeHistoryFixture(3),head=f.versions.at(-1)!;
 for(const rows of [f.versions.slice(1),[f.versions[0],f.versions[2]],[f.versions[0],{...f.versions[1],id:f.versions[0]!.id},head],[f.versions[0],{...f.versions[1],operation_id:f.versions[0]!.operation_id},head],[f.versions[0],{...f.versions[1],dropoff_enabled:true},head],[...f.versions.slice(0,2),{...head,reason:'Changed head text'}]])await expect(buildFulfillmentModeArchive(f.businessId,head,rows)).rejects.toThrow();
});
it('retrieves same-flag history only for enabled Drop-Off policy revisions',async()=>{
 const f=modeHistoryFixture(3),prior=f.versions[0]!;
 f.versions[1]={...f.versions[1]!,dropoff_enabled:prior.dropoff_enabled,reason:'Require a photo at handoff'};
 const rows=f.versions.slice(0,2),head=rows.at(-1)!;
 const parts=unzipSync(await buildFulfillmentModeArchive(f.businessId,head,rows,true));
 expect(JSON.parse(strFromU8(parts['saved_history.json']!)).versions).toEqual(rows);
 const disabled={...head,dropoff_enabled:false},disabledRevision={...f.versions[2]!,dropoff_enabled:false};
 await expect(buildFulfillmentModeArchive(f.businessId,disabledRevision,[prior,disabled,disabledRevision],true)).rejects.toThrow();
});
it('does not invent chronological monotonicity when retained wall clocks differ',async()=>{const f=modeHistoryFixture();f.versions[1]={...f.versions[1]!,created_at:'2026-10-01T01:00:00.123456Z'};expect(await buildFulfillmentModeArchive(f.businessId,f.versions.at(-1),f.versions)).toBeInstanceOf(Uint8Array);});
it('enforces the disclosed version bound without truncating history',async()=>{const f=modeHistoryFixture(1001);await expect(buildFulfillmentModeArchive(f.businessId,f.versions.at(-1),f.versions)).rejects.toThrow();});
