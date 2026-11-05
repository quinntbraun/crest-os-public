import {parseSourceExportCommand,parseSourceExportCommitted} from './source-export-job-contract.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
export class SourceExportAdmissionError extends Error{constructor(){super('SOURCE_EXPORT_EXECUTION_REVIEW_REQUIRED');this.name='SourceExportAdmissionError';}}
function require(value:unknown):asserts value{if(!value)throw new SourceExportAdmissionError();}
function object(value:unknown,keys:readonly string[]){
 require(value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
 const fields=Object.getOwnPropertyDescriptors(value);require(Reflect.ownKeys(fields).length===keys.length&&keys.every(key=>fields[key]?.enumerable&&Object.hasOwn(fields[key]!,'value')));
 return Object.fromEntries(keys.map(key=>[key,fields[key]!.value])) as Record<string,unknown>;
}
export type SourceExportAdmission=Readonly<{state:'created'|'recorded';result:ReturnType<typeof parseSourceExportCommitted>}>|Readonly<{state:'conflict';reason:'operation'|'active_or_identity'}>;
// Data only. This distinction is not worker authorization, an execution token,
// a current lease or evidence that a background task started/completed.
export function parseSourceExportAdmission(input:unknown,original:unknown,actorId:string):SourceExportAdmission{
 try{
  const command=parseSourceExportCommand(original);require(command.commandType==='export.request'&&uuid(actorId));
  require(input!==null&&typeof input==='object');const fields=Object.getOwnPropertyDescriptors(input),state=fields.state;require(state?.enumerable&&Object.hasOwn(state,'value'));
  if(state.value==='conflict'){const value=object(input,['state','reason']);require(value.reason==='operation'||value.reason==='active_or_identity');return Object.freeze({state:'conflict',reason:value.reason});}
  const value=object(input,['state','result']);require(value.state==='created'||value.state==='recorded');const result=parseSourceExportCommitted(value.result,command,actorId);
  return Object.freeze({state:value.state,result});
 }catch{throw new SourceExportAdmissionError();}
}
