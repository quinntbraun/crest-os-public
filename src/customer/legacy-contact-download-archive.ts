import 'server-only';
import {createHash} from 'node:crypto';
import {zipSync} from 'fflate';
import {customerInstant,customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {legacyApplicationReceipt,legacyApplicationRow,legacyApplyRequestStatus} from './legacy-contact-application-contract.ts';
import {legacyContactDownloadLimit,legacyContactOutcomeHeader,legacyContactRequestHeader} from './legacy-contact-download-contract.ts';
import type {parseLegacyContactDownloadRequest} from './legacy-contact-download-contract.ts';

type Reference=ReturnType<typeof parseLegacyContactDownloadRequest>;
const sha256=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const sourceDigest=(value:unknown):value is string=>typeof value==='string'&&value.length===64&&/^[a-f0-9]+$/.test(value);

function* lines(value:string){
 let offset=0;
 while(offset<value.length){
  const end=value.indexOf('\r\n',offset);
  check(end>offset&&end-offset<=256);
  yield value.slice(offset,end).split(',');
  offset=end+2;
 }
}

export function createLegacyContactDownloadArchive(value:unknown,businessId:string,request:Reference,signal:AbortSignal){
 signal.throwIfAborted();
 if(exact(value,['state'])&&value.state==='absent')return null;
 check(exact(value,['state','receipt','outcomes','requests'])&&value.state==='present'&&typeof value.outcomes==='string'&&
  typeof value.requests==='string'&&Buffer.byteLength(value.outcomes)+Buffer.byteLength(value.requests)<legacyContactDownloadLimit-4096);
 const receipt=legacyApplicationReceipt(value.receipt,businessId,request.batchId);
 check(receipt.operationId===request.applicationOperationId);

 let nextRow=2,skipped=0,pairs=0,priorOperation='';
 const customers=new Set<string>(),vehicles=new Set<string>();
 for(const fields of lines(value.outcomes)){
  signal.throwIfAborted();
  check(fields.length===8&&fields[0]===String(nextRow)&&/^[1-9][0-9]*$/.test(fields[1]!));
  const [row,decisionRevision,customerAction,customerId,customerVersion,vehicleAction,vehicleId,vehicleVersion]=fields;
  const parsed=legacyApplicationRow({row:Number(row),decisionRevision:Number(decisionRevision),customerAction,customerId:customerId||null,
   customerVersion:customerVersion||null,vehicleAction,vehicleId:vehicleId||null,vehicleVersion:vehicleVersion||null},nextRow++);
  if(parsed.customerAction==='skip')skipped++;
  if(parsed.vehicleId)pairs++;
  if(parsed.customerAction==='create'&&parsed.customerId)customers.add(parsed.customerId);
  if(parsed.vehicleAction==='create'&&parsed.vehicleId)vehicles.add(parsed.vehicleId);
 }
 check(nextRow===receipt.rowCount+2&&skipped===receipt.skippedRows&&pairs===receipt.rowsWithVehiclePair&&
  customers.size===receipt.customersCreated&&vehicles.size===receipt.vehiclesCreated);
 for(const fields of lines(value.requests)){
  signal.throwIfAborted();
  const [operation,digest,actor,started,status,finished,attempts]=fields;
  check(fields.length===7&&customerUuid(operation)&&operation>priorOperation&&sourceDigest(digest)&&customerUuid(actor)&&
   customerInstant(started)&&/^[0-3]$/.test(attempts??''));
  const state=legacyApplyRequestStatus({state:status,operationId:operation});
  check(state.state!=='absent'&&(state.state==='queued'?finished==='':customerInstant(finished)&&finished>=started)&&
   (state.state!=='review'||attempts==='3'));
  priorOperation=operation;
 }

 const entries={
  'import-receipt.json':Buffer.from(JSON.stringify(receipt,null,2)+'\n'),
  'row-results.csv':Buffer.from(legacyContactOutcomeHeader+value.outcomes),
  'import-requests.csv':Buffer.from(legacyContactRequestHeader+value.requests),
 };
 try{
  const bytes=new Uint8Array(zipSync(entries,{level:3,mtime:new Date(2000,0,1)}));
  if(bytes.byteLength===0||bytes.byteLength>legacyContactDownloadLimit||signal.aborted){bytes.fill(0);throw Error('LEGACY_DOWNLOAD_UNAVAILABLE');}
  return {bytes,digest:sha256(bytes)};
 }finally{for(const bytes of Object.values(entries))bytes.fill(0);}
}
