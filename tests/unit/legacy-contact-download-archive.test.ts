import {describe,expect,it,vi} from 'vitest';
import {strFromU8,unzipSync} from 'fflate';
import {createLegacyContactDownloadArchive} from '../../src/customer/legacy-contact-download-archive.ts';
import {legacyContactDownloadLimit} from '../../src/customer/legacy-contact-download-contract.ts';

vi.mock('server-only',()=>({}));
const key=(n:number)=>'123e4567-e89b-42d3-a456-'+String(n).padStart(12,'0');
const business=key(1),batch=key(2),operation=key(3),approval=key(4),actor=key(5),epoch=key(6);
const hash='a'.repeat(64),stamp='2026-11-16T11:30:00.000000Z';
const request={batchId:batch,applicationOperationId:operation,recoveryEpoch:epoch};
const receipt={schemaVersion:1,businessId:business,batchId:batch,approvalId:approval,operationId:operation,evidenceSha256:hash,
 sourceNamespace:'fixture-import',rowCount:2,skippedRows:1,customersCreated:1,vehiclesCreated:0,rowsWithVehiclePair:0};
const fixture={state:'present',receipt,outcomes:'2,1,create,'+key(10)+',1,none,,\r\n3,1,skip,,,none,,\r\n',
 requests:[operation,hash,actor,stamp,'committed',stamp,1].join(',')+'\r\n'};
const build=(value:unknown)=>createLegacyContactDownloadArchive(value,business,request,new AbortController().signal);

describe('contact import download archive',()=>{
 it('delivers deterministic portable bytes with an exact receipt and CSV headers',()=>{
  const archive=build(fixture);
  expect(archive).toEqual(build(fixture));
  const parts=unzipSync(archive!.bytes);
  expect(Object.keys(parts)).toEqual(['import-receipt.json','row-results.csv','import-requests.csv']);
  expect(JSON.parse(strFromU8(parts['import-receipt.json']!))).toEqual(receipt);
  expect(strFromU8(parts['row-results.csv']!)).toContain(fixture.outcomes);
  expect(strFromU8(parts['import-requests.csv']!)).toContain(fixture.requests);
 });
 it('rejects wrong operation, unsafe fields and missing or reordered rows',()=>{
  for(const value of [
   {...fixture,receipt:{...receipt,operationId:key(50)}},
   {...fixture,outcomes:fixture.outcomes.replace('create','=2+2')},
   {...fixture,outcomes:fixture.outcomes.replace('3,1,skip','5,1,skip')},
   {...fixture,outcomes:fixture.outcomes.split('3,1,skip')[0]},
   {...fixture,requests:fixture.requests.replace('committed','review')},
  ])expect(()=>build(value)).toThrow();
 });
 it('keeps the full 100,000-row limit, including the final reconciliation row',()=>{
  const rowCount=100000;
  const outcomes=Array.from({length:rowCount},(_,n)=>[n+2,1,'create',key(n+10),1,'create',key(n+rowCount+10),1].join(',')+'\r\n').join('');
  const archive=build({...fixture,receipt:{...receipt,rowCount,skippedRows:0,customersCreated:rowCount,
   vehiclesCreated:rowCount,rowsWithVehiclePair:rowCount},outcomes});
  expect(archive!.bytes.byteLength).toBeLessThan(legacyContactDownloadLimit);
  const csv=strFromU8(unzipSync(archive!.bytes)['row-results.csv']!);
  expect(csv.match(/\r\n/g)).toHaveLength(rowCount+1);
  expect(csv.endsWith([rowCount+1,1,'create',key(rowCount+9),1,'create',key(rowCount*2+9),1].join(',')+'\r\n')).toBe(true);
 });
});
