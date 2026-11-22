import 'server-only';
import {randomUUID} from 'node:crypto';
import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {googleCalendarSetupStatements as sql} from './google-calendar-database.ts';
import {parseCalendarConnectionSummary,parseCalendarDisconnectStatus} from './google-calendar-disconnect-contract.ts';
import {createGoogleCalendarCredentialStore} from './google-calendar-credential-store.ts';
import {createGoogleCalendarOAuthTransport} from './google-calendar-oauth-transport.ts';
import type {GoogleCalendarRetainedGrant} from './google-calendar-oauth-transport.ts';
type Query=(statement:string,values:unknown[],signal:AbortSignal)=>Promise<unknown>;
type Config=Readonly<{clientId:string;clientSecret:string;callbackUri:string;credentialKeyId:string;store:Awaited<ReturnType<typeof createGoogleCalendarCredentialStore>>;query:Query;request:typeof fetch}>;
export function createGoogleCalendarDisconnect(config:Config){
 const {query,store,clientId,clientSecret,callbackUri,credentialKeyId,request}=config;
 const requireId=(...ids:unknown[])=>{if(!ids.every(uuid))throw Error('GOOGLE_CALENDAR_DISCONNECT_UNVERIFIED');};
 async function status(args:unknown[],destinationId:string,disconnectId:string,signal:AbortSignal){
  requireId(destinationId,disconnectId);signal.throwIfAborted();
  return parseCalendarDisconnectStatus(await query(sql.disconnectStatus,[...args,destinationId,disconnectId,'read',null],signal),disconnectId);
 }
 return Object.freeze({
  async summary(args:unknown[],signal:AbortSignal){signal.throwIfAborted();return parseCalendarConnectionSummary(await query(sql.connection,args,signal));},
  async begin(args:unknown[],destinationId:string,generation:string,operationId:string,signal:AbortSignal){
   requireId(destinationId,operationId);if(!version(generation))throw Error('GOOGLE_CALENDAR_DISCONNECT_UNVERIFIED');signal.throwIfAborted();
   const value=await query(sql.disconnect,[...args,destinationId,generation,operationId],signal);
   if(!exact(value,['schemaVersion','disconnectId','destinationId','generation','fencedAt','drainUntil'])||value.schemaVersion!==1||!uuid(value.disconnectId)||value.destinationId!==destinationId||value.generation!==(BigInt(generation)+1n).toString()||typeof value.fencedAt!=='string'||!Number.isFinite(Date.parse(value.fencedAt))||typeof value.drainUntil!=='string'||!Number.isFinite(Date.parse(value.drainUntil)))throw Error('GOOGLE_CALENDAR_DISCONNECT_UNVERIFIED');
   return status(args,destinationId,value.disconnectId,signal);
  },
  status,
  async continue(args:unknown[],destinationId:string,disconnectId:string,external:AbortSignal){
   const current=await status(args,destinationId,disconnectId,external);
   if(current.state!=='ready_to_revoke')return current;
   const attemptId=randomUUID();
   const receipt=await query(sql.disconnectStatus,[...args,destinationId,disconnectId,'admit',attemptId],external);
   if(!exact(receipt,['state','disconnectId','attemptId','deadline','admissionVersion'])||receipt.state!=='revocation_admitted')return parseCalendarDisconnectStatus(receipt,disconnectId);
   if(receipt.disconnectId!==disconnectId||receipt.attemptId!==attemptId||receipt.admissionVersion!==1||typeof receipt.deadline!=='string')throw Error('GOOGLE_CALENDAR_DISCONNECT_UNVERIFIED');
   const deadline=Date.parse(receipt.deadline),now=Date.now();
   let admitted=false;
   let outcome:'revoked'|'uncertain'='uncertain';
   try{
    if(!Number.isFinite(deadline)||deadline<=now||deadline>now+35000)throw Error('GOOGLE_CALENDAR_DISCONNECT_UNVERIFIED');
    const signal=AbortSignal.any([external,AbortSignal.timeout(Math.max(1,deadline-now))]);
    const retained=await query(sql.revocationCredential,[...args,destinationId,disconnectId,attemptId],signal);
    if(!exact(retained,['credentialId','version','keyId','envelope','generation','deadline'])||!uuid(retained.credentialId)||!version(retained.version)||!version(retained.generation)||retained.keyId!==credentialKeyId||retained.deadline!==receipt.deadline)throw Error('GOOGLE_CALENDAR_DISCONNECT_UNVERIFIED');
    const oauth=createGoogleCalendarOAuthTransport({clientId,clientSecret,callbackUri,request,async admit(operation,currentSignal){
     if(operation.kind!=='revoke'||operation.retained!==expected||admitted||currentSignal.aborted||Date.now()>=deadline)return false;
     admitted=true;return true;
    }});
    const expected:GoogleCalendarRetainedGrant=await store.open({businessId:args[7] as string,destinationId,recoveryEpoch:args[8] as string,connectionGeneration:retained.generation,clientId,credentialId:retained.credentialId,version:retained.version},{keyId:retained.keyId,envelope:retained.envelope},oauth.openRetained);
    const observed=await oauth.revoke(expected,signal);
    if(observed.state==='revoked')outcome='revoked';
   }catch{/* An admitted request's unknown result is retained for review. */}
   // Outcome persistence has its own short cleanup budget. SQL still checks
   // the actual owner/session/recovery/fence and admitted request deadline.
   const persisted=await query(sql.disconnectStatus,[...args,destinationId,disconnectId,outcome,attemptId],AbortSignal.timeout(5000));
   return parseCalendarDisconnectStatus(persisted,disconnectId);
  },
 });
}
