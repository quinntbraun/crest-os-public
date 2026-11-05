import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
import {customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseHoldSave,parseHoldCommitted,parseStoredHold,requireHold as check} from './appointment-hold-contract.ts';
import type {HoldSave} from './appointment-hold-contract.ts';
export class HoldDirectoryError extends Error{constructor(code:string){super(code);this.name='HoldDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(v:T){this.#value=v;}forServer(){return this.#value;}toJSON():never{throw new HoldDirectoryError('HOLD_VALUE_PRIVATE');}}
export function createHoldDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,business:string,signal:AbortSignal,work:(args:unknown[],signal:AbortSignal)=>Promise<T>){
  check(customerUuid(business));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);if(bounded.aborted)throw Error();let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),business],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async save(credential:string,input:HoldSave,signal:AbortSignal){let submitted=false;
   try{const request=parseHoldSave(input);return await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,current)=>{
    if(current.aborted)throw Error();submitted=true;const v=await query('SELECT crest_commands.save_appointment_hold($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,request.holdId,request.expectedSequence,request.payload]);if(current.aborted)throw Error();
    if(exact(v,['state','reason'])&&v.state==='conflict'&&['operation','review'].includes(v.reason as string))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:v.reason as 'operation'|'review'}));
    if(exact(v,['state','reason','currentSequence'])&&v.state==='conflict'&&v.reason==='version'&&customerVersion(v.currentSequence,true))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentSequence:v.currentSequence}));
    const result=parseHoldCommitted(v,request.businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.holdId===request.holdId&&BigInt(result.receipt.sequence)===BigInt(request.expectedSequence)+1n);return new PrivateValue(result);
   },bounded));}catch(e){if(e instanceof Error&&e.message==='RECOVERY_REVIEW_REQUIRED')throw new HoldDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new HoldDirectoryError(submitted?'HOLD_SAVE_OUTCOME_UNKNOWN':'HOLD_SAVE_NOT_SUBMITTED');}
  },
  async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&customerUuid(input.businessId)&&customerUuid(input.operationId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const v=await database('SELECT crest_commands.lookup_appointment_hold_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);check(!bounded.aborted);return new PrivateValue(exact(v,['state'])&&v.state==='absent'?Object.freeze({state:'absent' as const}):parseHoldCommitted(v,request.businessId,request.operationId));});}catch{throw new HoldDirectoryError('HOLD_REQUEST_FAILED');}
  },
  async list(credential:string,input:{businessId:string;afterId:string|null;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','afterId','pageSize'])&&(input.afterId===null||customerUuid(input.afterId))&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const v=await database('SELECT crest_commands.read_appointment_holds($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::integer) AS result',[...args,request.afterId,request.pageSize],bounded);
    check(!bounded.aborted&&exact(v,['schemaVersion','businessId','holds','hasMore'])&&v.schemaVersion===1&&v.businessId===request.businessId&&Array.isArray(v.holds)&&v.holds.length<=request.pageSize&&typeof v.hasMore==='boolean');let prior=request.afterId;
    const holds=v.holds.map(value=>{const h=parseStoredHold(value,request.businessId);check(prior===null||h.hold_id>prior);prior=h.hold_id;return h;});check(!v.hasMore||holds.length===request.pageSize);return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,holds:Object.freeze(holds),hasMore:v.hasMore}));
   });}catch{throw new HoldDirectoryError('HOLD_REQUEST_FAILED');}
  },
  async history(credential:string,input:{businessId:string;holdId:string;afterSequence:string;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','holdId','afterSequence','pageSize'])&&customerUuid(input.holdId)&&customerVersion(input.afterSequence,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const v=await database('SELECT crest_commands.read_appointment_hold_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::integer) AS result',[...args,request.holdId,request.afterSequence,request.pageSize],bounded);check(!bounded.aborted);if(exact(v,['state'])&&v.state==='absent')return new PrivateValue(Object.freeze({state:'absent' as const}));
    check(exact(v,['schemaVersion','businessId','holdId','currentSequence','versions','hasMore'])&&v.schemaVersion===1&&v.businessId===request.businessId&&v.holdId===request.holdId&&customerVersion(v.currentSequence)&&Array.isArray(v.versions)&&typeof v.hasMore==='boolean');let prior=BigInt(request.afterSequence);
    const versions=v.versions.map(value=>{const h=parseStoredHold(value,request.businessId);check(h.hold_id===request.holdId&&BigInt(h.sequence)===prior+1n&&BigInt(h.sequence)<=BigInt(v.currentSequence as string));prior=BigInt(h.sequence);return h;});const remaining=BigInt(v.currentSequence)>BigInt(request.afterSequence)?BigInt(v.currentSequence)-BigInt(request.afterSequence):0n;check(BigInt(versions.length)===(remaining>BigInt(request.pageSize)?BigInt(request.pageSize):remaining)&&v.hasMore===(remaining>BigInt(request.pageSize)));
    return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,holdId:request.holdId,currentSequence:v.currentSequence,versions:Object.freeze(versions),hasMore:v.hasMore}));
   });}catch{throw new HoldDirectoryError('HOLD_REQUEST_FAILED');}
  }
 });
}
