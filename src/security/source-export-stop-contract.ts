import {parseSourceExportCommand,parseSourceExportCommitted} from './source-export-job-contract.ts';
import type {SourceExportCommand} from './source-export-job-contract.ts';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
export type SourceExportStopCommand=Extract<SourceExportCommand,{commandType:'export.stop'}>;
function require(value:unknown):asserts value{if(!value)throw Error('SOURCE_EXPORT_STOP_REVIEW_REQUIRED');}
export function parseSourceExportStopCommand(input:unknown,businessId:string):SourceExportStopCommand{
 const command=parseSourceExportCommand(input);require(customerUuid(businessId)&&command.businessId===businessId&&command.commandType==='export.stop');return command;
}
export function parseSourceExportStopOutcome(input:unknown,command:SourceExportStopCommand,actorId:string,allowAbsent=false){
 if(allowAbsent&&exact(input,['state'])&&input.state==='absent')return Object.freeze({state:'absent' as const});
 if(!allowAbsent&&exact(input,['state'])&&input.state==='busy')return Object.freeze({state:'busy' as const});
 if(!allowAbsent&&exact(input,['state','reason'])&&input.state==='conflict'&&['operation','active_or_identity','version','state'].includes(input.reason as string))return Object.freeze({state:'conflict' as const,reason:input.reason as 'operation'|'active_or_identity'|'version'|'state'});
 return parseSourceExportCommitted(input,command,actorId);
}
export function parseSourceExportStopWire(input:unknown,businessId:string){
 require(exact(input,['originalJson'])&&typeof input.originalJson==='string'&&new TextEncoder().encode(input.originalJson).length<=2048);
 const raw=input.originalJson,command=parseSourceExportStopCommand(JSON.parse(raw),businessId);
 require((raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===Object.keys(command).length+Object.keys(command.reference).length);
 return command;
}
export function sourceExportStopToWire(input:SourceExportStopCommand){const command=parseSourceExportStopCommand(input,input.businessId);return Object.freeze({originalJson:JSON.stringify(command)});}
