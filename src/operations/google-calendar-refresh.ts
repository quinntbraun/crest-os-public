import 'server-only';
import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {googleCalendarWorkerStatements as sql} from './google-calendar-database.ts';
import {createGoogleCalendarOAuthTransport} from './google-calendar-oauth-transport.ts';
import {createGoogleCalendarIdentityVerifier} from './google-calendar-identity.ts';
import type {GoogleCalendarRetainedGrant} from './google-calendar-oauth-transport.ts';
import type {createGoogleCalendarCredentialStore} from './google-calendar-credential-store.ts';
type Target=Readonly<{businessId:string;destinationId:string;recoveryEpoch:string;generation:string}>;
type Query=(statement:string,values:unknown[],signal:AbortSignal)=>Promise<unknown>;
type Outcome=Readonly<{state:'refreshed';grant:GoogleCalendarRetainedGrant}>|Readonly<{state:'delayed'|'reconnect'|'review'|'uncertain'}>;
type Config=Readonly<{clientId:string;clientSecret:string;callbackUri:string;credentialKeyId:string;store:Awaited<ReturnType<typeof createGoogleCalendarCredentialStore>>;query:Query;request:typeof fetch}>;

// A durable per-version claim is also the provider budget reservation. A
// missing/older admission protocol never permits a live token request.
export function createGoogleCalendarRefresh(config:Config){
 const {clientId,clientSecret,callbackUri,credentialKeyId,store,query,request}=config;
 const verifyIdentity=createGoogleCalendarIdentityVerifier(clientId,request);
 return async(input:Target,external:AbortSignal):Promise<Outcome>=>{
  const target=Object.freeze({...input}),{businessId,destinationId,recoveryEpoch,generation}=target;
  if(![businessId,destinationId,recoveryEpoch].every(uuid)||!version(generation)||external.aborted)return {state:'review'};
  const args=[businessId,destinationId,recoveryEpoch,generation];
  let claimId:string|undefined,admitted=false;
  async function finish(outcome:'rotated'|'reconnect'|'uncertain',sealed?:Awaited<ReturnType<typeof store.seal>>){
   try{
    if(!claimId)return false;
    const value=await query(sql.refreshFinish,[...args,claimId,outcome,sealed?.keyId??null,sealed?.envelope??null],AbortSignal.timeout(5000));
    return exact(value,['state'])&&value.state===outcome;
   }catch{return false;}
  }
  try{
   const claim=await query(sql.refreshClaim,args,external);
   if(exact(claim,['state'])){
    if(claim.state==='busy'||claim.state==='delayed')return {state:'delayed'};
    if(claim.state==='reconnect'||claim.state==='uncertain')return {state:claim.state};
   }
   if(!exact(claim,['state','claimId','deadline','credentialId','version','keyId','envelope','admissionVersion'])||claim.state!=='claimed'||claim.admissionVersion!==1||!uuid(claim.claimId)||!uuid(claim.credentialId)||!version(claim.version)||BigInt(claim.version)>=9223372036854775807n||claim.keyId!==credentialKeyId||typeof claim.deadline!=='string')return {state:'review'};
   claimId=claim.claimId;const deadline=Date.parse(claim.deadline),now=Date.now();
   if(!Number.isFinite(deadline)||deadline<=now||deadline>now+35000){await finish('uncertain');return {state:'uncertain'};}
   const signal=AbortSignal.any([external,AbortSignal.timeout(Math.max(1,deadline-now))]);
   const oauth=createGoogleCalendarOAuthTransport({clientId,clientSecret,callbackUri,request,verifyIdentity,async admit(operation,current){
    if(operation.kind!=='refresh'||operation.retained!==expected||admitted||current.aborted||Date.now()>=deadline)return false;
    admitted=true;return true;
   }});
   const binding={businessId,destinationId,recoveryEpoch,connectionGeneration:generation,clientId,credentialId:claim.credentialId,version:claim.version};
   const expected=await store.open(binding,{keyId:claim.keyId,envelope:claim.envelope},oauth.openRetained);
   const result=await oauth.refresh(expected,signal);
   if(result.state!=='granted'){
    const outcome=result.state==='reconnect'?'reconnect':'uncertain';return {state:await finish(outcome)?outcome:'uncertain'};
   }
   // An observed replacement must be sealed/persisted even if the caller
   // cancelled after the provider replied. SQL still fences disconnect/epoch.
   const replacement=await store.seal({...binding,version:(BigInt(binding.version)+1n).toString()},result.grant);
   if(Date.now()>=deadline||!await finish('rotated',replacement))return {state:'uncertain'};
   return {state:'refreshed',grant:result.grant};
  }catch{
   if(claimId)await finish(admitted?'uncertain':'reconnect');
   return {state:admitted?'uncertain':'review'};
  }
 };
}
