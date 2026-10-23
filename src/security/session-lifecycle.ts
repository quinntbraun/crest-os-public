import 'server-only';
import {randomUUID} from 'node:crypto';
import {decodeJwt} from 'jose';
import {sessionDatabase} from './session-database.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import {createSessionCredential,sessionCredentialHash} from './session-credential.ts';
import {createSessionRevoker} from './session-revocation-db.ts';
import {localSessionEligibility} from './session-policy.ts';
import type {LocalSession,LocalActor} from './session-policy.ts';
import type {createProviderBoundary,ProviderBinding,ProviderIdentity,ProviderPasswordSessionReference} from './provider-auth.ts';
import type {createProviderTokenStore,TokenBinding} from './provider-token-store.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class SessionLifecycleError extends Error{
  constructor(){super('SESSION_LIFECYCLE_FAILED');this.name='SessionLifecycleError';}
}
type LoginAttempt=Readonly<{attemptId:string;appSessionId:string;actorId:string;securityEpoch:string;issuer:string;subject:string}>;
type Snapshot={id:string;version:string;now:number;binding:TokenBinding;actor:LocalActor;session:LocalSession;keyId:string;ciphertext:string};
type Verified=Readonly<{state:'session_verified';sessionId:string;actorId:string;expiresAt:number;provider:ProviderIdentity;
  tenantAndRequestVerificationRequired:true;foregroundActivityAt:number|null}>;
class IssuedSession{
  #credential:ReturnType<typeof createSessionCredential>;
  readonly evidence:Verified;
  constructor(credential:ReturnType<typeof createSessionCredential>,evidence:Verified){this.#credential=credential;this.evidence=evidence;Object.freeze(this);}
  cookieValueForResponse(){return this.#credential.cookieValueForResponse();}
  toJSON():never{throw new SessionLifecycleError();}
}
function snapshot(value:unknown):Snapshot{
  if(!value||typeof value!=='object')throw new SessionLifecycleError();
  const v=value as Snapshot;
  if(typeof v.id!=='string'||!uuid.test(v.id)||typeof v.version!=='string'||!/^[1-9][0-9]{0,18}$/.test(v.version)
    ||!Number.isSafeInteger(v.now)||!v.binding||v.binding.appSessionId!==v.id||v.binding.actorId!==v.actor?.id
    ||v.binding.securityEpoch!==v.session?.issuedSecurityEpoch||v.binding.providerSessionId===undefined
    ||typeof v.ciphertext!=='string'||v.ciphertext.length>90000||typeof v.keyId!=='string')throw new SessionLifecycleError();
  if(localSessionEligibility(v.session,v.actor,v.now,'background').state!=='locally_eligible')throw new SessionLifecycleError();
  return v;
}
export function createSessionLifecycle(config:SessionDatabaseConfiguration,
  provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const query=sessionDatabase(config),revoke=createSessionRevoker(config);
  const finish=async(attempt:LoginAttempt,phase:'registration_closed'|'stopped_review',signal:AbortSignal)=>{
    const result=await query('SELECT crest_commands.finish_provider_login($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text) AS result',
      [attempt.attemptId,attempt.actorId,attempt.securityEpoch,attempt.issuer,attempt.subject,phase],signal) as
      {evidence?:{attemptId?:string;appSessionId?:string;actorId?:string;securityEpoch?:string;providerIssuer?:string;providerSubject?:string;phase?:string}}|null;
    const e=result?.evidence;
    if(signal.aborted||!e||e.attemptId!==attempt.attemptId||e.appSessionId!==attempt.appSessionId||e.actorId!==attempt.actorId
      ||e.securityEpoch!==attempt.securityEpoch||e.providerIssuer!==attempt.issuer||e.providerSubject!==attempt.subject||e.phase!==phase)throw new SessionLifecycleError();
  };
  const read=async(hash:Buffer,signal:AbortSignal)=>snapshot(await query('SELECT crest_commands.app_session_snapshot($1::bytea) AS result',[hash],signal));
  async function rotate(credential:string,hash:Buffer,observed:Snapshot,signal:AbortSignal):Promise<void>{
    let attempted=false;
    try{
      await query.transaction(async(transaction,currentSignal)=>{
        const current=snapshot(await transaction('SELECT crest_commands.lock_app_session($1::bytea) AS result',[hash]));
        const material=await tokens.decrypt({keyId:current.keyId,ciphertext:Buffer.from(current.ciphertext,'base64')},current.binding);
        if(current.version!==observed.version){
          // A preceding rotation won. Use its live verified token, never the
          // stale refresh material read before waiting for the session lock.
          const identity=await provider.verifyAccess(material.tokensForProvider().accessToken,{subject:current.binding.subject,sessionId:current.binding.providerSessionId},currentSignal);
          if(identity.issuer!==current.binding.issuer)throw new SessionLifecycleError();
          return;
        }
        attempted=true;
        const refreshed=await provider.refreshForSession(material.tokensForProvider(),{subject:current.binding.subject,sessionId:current.binding.providerSessionId},currentSignal);
        if(refreshed.identity.issuer!==current.binding.issuer)throw new SessionLifecycleError();
        const encrypted=await tokens.encrypt(refreshed.tokensForServerStorage(),current.binding);
        await transaction('SELECT crest_commands.replace_session_tokens($1::bytea,$2::bigint,$3::bytea,$4::text,$5::uuid) AS result',
          [hash,current.version,Buffer.from(encrypted.ciphertext),encrypted.keyId,randomUUID()]);
      },signal);
    }catch{
      // Once an exchange may have consumed a refresh token, an uncertain
      // rollback/commit must not leave the local session usable with old data.
      if(attempted)try{await revoke(credential,new AbortController().signal);}catch{/* bounded best effort */}
      throw new SessionLifecycleError();
    }
  }
  async function verify(credential:string,signal:AbortSignal,interaction:'foreground'|'background',recent:boolean,allowRefresh=true):Promise<Verified>{
    const hash=sessionCredentialHash(credential);
    try{
      let first=await read(hash,signal),material=await tokens.decrypt({keyId:first.keyId,ciphertext:Buffer.from(first.ciphertext,'base64')},first.binding);
      // Decoded expiry is only a scheduling hint, never authentication evidence.
      // Both the historical reference and replacement are signature verified.
      const expiry=decodeJwt(material.tokensForProvider().accessToken).exp;
      if(typeof expiry!=='number'||!Number.isSafeInteger(expiry*1000))throw new SessionLifecycleError();
      if(allowRefresh&&expiry*1000<=Math.max(first.now,Date.now())+60000){
        await rotate(credential,hash,first,signal);first=await read(hash,signal);
        material=await tokens.decrypt({keyId:first.keyId,ciphertext:Buffer.from(first.ciphertext,'base64')},first.binding);
      }
      const identity=await provider.verifyAccess(material.tokensForProvider().accessToken,{subject:first.binding.subject,sessionId:first.binding.providerSessionId},signal);
      if(identity.issuer!==first.binding.issuer)throw new SessionLifecycleError();
      // No cross-request cache. Reread after provider I/O so concurrent local
      // revoke/epoch/disable/rotation cannot produce evidence from the old row.
      const last=await read(hash,signal);
      if(last.id!==first.id||last.version!==first.version||JSON.stringify(last.binding)!==JSON.stringify(first.binding)
        ||identity.expiresAt<=Math.max(last.now,Date.now()))throw new SessionLifecycleError();
      const eligible=localSessionEligibility(last.session,last.actor,last.now,interaction,recent);
      if(eligible.state!=='locally_eligible'||signal.aborted)throw new SessionLifecycleError();
      return Object.freeze({state:'session_verified',sessionId:last.id,actorId:last.actor.id,expiresAt:last.session.expiresAt,provider:identity,
        tenantAndRequestVerificationRequired:true,foregroundActivityAt:eligible.foregroundActivityAt});
    }finally{hash.fill(0);}
  }
  return Object.freeze({
    async logout(credential:string,external:AbortSignal):Promise<Readonly<{localRevoked:true;providerSignedOut:boolean}>>{
      const signal=AbortSignal.any([external,AbortSignal.timeout(20000)]);let hash:Buffer|undefined;
      try{
        hash=sessionCredentialHash(credential);let saved:Snapshot|null=null;
        // Snapshot failure must not prevent authoritative local revocation.
        try{saved=await query('SELECT crest_commands.app_session_snapshot($1::bytea) AS result',[hash],signal) as Snapshot|null;}catch{/* local revoke still required */}
        await revoke(credential,signal);
        let providerSignedOut=false;
        try{
          if(saved&&saved.id===saved.binding.appSessionId){
            const material=await tokens.decrypt({keyId:saved.keyId,ciphertext:Buffer.from(saved.ciphertext,'base64')},saved.binding);
            await provider.signOutLocal(material.tokensForProvider().accessToken,{subject:saved.binding.subject,sessionId:saved.binding.providerSessionId},signal);providerSignedOut=true;
          }
        }catch{/* provider failure cannot restore committed local authority */}
        return Object.freeze({localRevoked:true,providerSignedOut});
      }catch{throw new SessionLifecycleError();}finally{hash?.fill(0);}
    },
    async refresh(credential:string,external:AbortSignal):Promise<Verified>{
      const signal=AbortSignal.any([external,AbortSignal.timeout(20000)]);let hash:Buffer|undefined;
      try{hash=sessionCredentialHash(credential);await rotate(credential,hash,await read(hash,signal),signal);return await verify(credential,signal,'background',false,false);}
      catch{throw new SessionLifecycleError();}finally{hash?.fill(0);}
    },
    async login(input:{email:string;password:string;factorId:string;code:string},binding:ProviderBinding,trusted:boolean,external:AbortSignal):Promise<IssuedSession>{
      const signal=AbortSignal.any([external,AbortSignal.timeout(20000)]);let credential:ReturnType<typeof createSessionCredential>|undefined;
      let material:Awaited<ReturnType<typeof provider.authenticatePasswordTotp>>|undefined,attempt:LoginAttempt|undefined;
      try{
        input=Object.freeze({...input});binding=Object.freeze({...binding});
        if(typeof trusted!=='boolean'||signal.aborted||typeof input.email!=='string'||!input.email.trim()||input.email.length>320
          ||typeof input.password!=='string'||!input.password||input.password.length>1024||typeof input.factorId!=='string'||!uuid.test(input.factorId)
          ||typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||typeof binding.subject!=='string'||!uuid.test(binding.subject)||binding.sessionId!==undefined)throw new SessionLifecycleError();
        const attemptId=randomUUID(),id=randomUUID(),issuer=provider.issuerForServerBinding();
        // Confirm the durable marker before any provider exchange. Its epoch
        // remains pinned through issuance; recovery never rebases this login.
        const context=await query('SELECT crest_commands.begin_provider_login($1::uuid,$2::uuid,$3::text,$4::uuid) AS result',
          [attemptId,id,issuer,binding.subject],signal) as {attemptId?:string;appSessionId?:string;actorId?:string;securityEpoch?:string}|null;
        if(signal.aborted||!context||context.attemptId!==attemptId||context.appSessionId!==id||typeof context.actorId!=='string'||!uuid.test(context.actorId)
          ||typeof context.securityEpoch!=='string'||!uuid.test(context.securityEpoch))throw new SessionLifecycleError();
        attempt=Object.freeze({attemptId,appSessionId:id,actorId:context.actorId,securityEpoch:context.securityEpoch,issuer,subject:binding.subject});
        let target:ProviderPasswordSessionReference|undefined,observing=false;
        material=await provider.authenticatePasswordTotp(input,binding,signal,async(reference,currentSignal)=>{
          if(observing||currentSignal.aborted||signal.aborted||reference.issuer!==issuer||reference.subject!==binding.subject
            ||typeof reference.sessionId!=='string'||!uuid.test(reference.sessionId)||!Number.isSafeInteger(reference.passwordAt)
            ||!Number.isSafeInteger(reference.expiresAt)||reference.passwordAt<0||reference.expiresAt<=reference.passwordAt)throw new SessionLifecycleError();
          observing=true;const observed=Object.freeze({...reference});
          const saved=await query('SELECT crest_commands.record_provider_login_target($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::timestamptz) AS result',
            [attemptId,context.actorId,context.securityEpoch,issuer,binding.subject,observed.sessionId,new Date(observed.passwordAt),new Date(observed.expiresAt)],currentSignal) as
              {evidence?:{attemptId?:string;actorId?:string;securityEpoch?:string;providerIssuer?:string;providerSubject?:string;providerSessionId?:string}}|null;
          const evidence=saved?.evidence;
          if(signal.aborted||currentSignal.aborted||!evidence||evidence.attemptId!==attemptId||evidence.actorId!==context.actorId
            ||evidence.securityEpoch!==context.securityEpoch||evidence.providerIssuer!==issuer||evidence.providerSubject!==binding.subject
            ||evidence.providerSessionId!==observed.sessionId)throw new SessionLifecycleError();
          target=observed;
        });const identity=material.identity;
        if(!target||identity.issuer!==issuer||identity.subject!==binding.subject||identity.sessionId!==target.sessionId
          ||identity.passwordAt!==target.passwordAt)throw new SessionLifecycleError();
        credential=createSessionCredential();
        const encrypted=await tokens.encrypt(material.tokensForServerStorage(),{actorId:context.actorId,securityEpoch:context.securityEpoch,appSessionId:id,
          providerSessionId:identity.sessionId,subject:identity.subject,issuer:identity.issuer});
        const hash=credential.hashForDatabase();
        try{await query('SELECT crest_commands.issue_open_app_session($1::uuid,$2::bytea,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::timestamptz,$9::timestamptz,$10::boolean,$11::bytea,$12::text,$13::uuid) AS result',
          [id,hash,context.actorId,context.securityEpoch,identity.issuer,identity.subject,identity.sessionId,new Date(identity.passwordAt),new Date(identity.totpAt),trusted,Buffer.from(encrypted.ciphertext),encrypted.keyId,attemptId],signal);
        }finally{hash.fill(0);}
        await finish(attempt,'registration_closed',signal);
        return new IssuedSession(credential,await verify(credential.cookieValueForResponse(),signal,'background',true,false));
      }catch{
        // An uncertain commit must never release a credential. Best-effort
        // idempotent cleanup uses its own bounded connection even after abort.
        const cleanup=AbortSignal.timeout(4000);
        let stopped=false;
        if(attempt)try{await finish(attempt,'stopped_review',cleanup);stopped=true;}catch{/* leave uncertain finish for bounded reconciliation */}
        if(credential&&!stopped)try{await revoke(credential.cookieValueForResponse(),cleanup);}catch{/* still attempt scoped provider cleanup */}
        if(material)try{await provider.signOutLocal(material.tokensForServerStorage().accessToken,
          {subject:material.identity.subject,sessionId:material.identity.sessionId},cleanup);}catch{/* durable orphan reconciliation remains required */}
        throw new SessionLifecycleError();
      }
    },
    async verify(credential:string,external:AbortSignal,interaction:'foreground'|'background'='background',requireRecentAuth=false):Promise<Verified>{
      try{return await verify(credential,AbortSignal.any([external,AbortSignal.timeout(20000)]),interaction,requireRecentAuth);}catch{throw new SessionLifecycleError();}
    }
  });
}
