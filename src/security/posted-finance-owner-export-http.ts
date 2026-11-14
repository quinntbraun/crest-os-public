import 'server-only';
import {createHash} from 'node:crypto';
import {zipSync} from 'fflate';
import {customerInstant,customerUuid} from '../customer/customer-contract.ts';
import {verifyFinanceSourceExport} from '../tooling/verify-finance-source-export.ts';
import {createServiceRefundSourceCollector} from './business-foundation-collector.ts';
import {readBrowserCookies} from './browser-http.ts';
import {readFlatJsonBody,privateJsonResponse} from './private-http.ts';
import {createRequestProtection} from './request-protection.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {sessionDatabase} from './session-database.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import {createSessionRequestAdmission} from './session-request-admission.ts';
import {createSessionCsrfVerifier} from './session-request-guard.ts';
import {downloadObject} from './source-export-download-contract.ts';
import {createTrustedTransport} from './trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from './trusted-transport.ts';
import {postedFinanceExportLimit,postedFinanceExportName,postedFinanceExportPath,postedFinanceExportProfile,excessReceiptExportProfile} from './posted-finance-owner-export-contract.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string;
 exportConnectionString:string;appReleaseId:string;sourceSchemaVersion:number};
const authority='$1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid';
const digest=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function require(value:unknown):asserts value{if(!value)throw Error('POSTED_FINANCE_EXPORT_UNAVAILABLE');}
export function postedFinanceExportFailure(status=503){
 const response=privateJsonResponse({error:'POSTED_FINANCE_EXPORT_UNAVAILABLE'},status);
 if(status===405)response.headers.set('Allow','POST');
 if(status===429)response.headers.set('Retry-After','60');
 return response;
}

export function createPostedFinanceOwnerExportHttp(config:Configuration,provider:Parameters<typeof createSessionLifecycle>[1],
 tokens:Parameters<typeof createSessionLifecycle>[2]){
 const {businessId,environment,appReleaseId,sourceSchemaVersion}=config;
 if(environment!=='test'||!customerUuid(businessId)||!/^[a-f0-9]{40}$/.test(appReleaseId)
  ||!Number.isSafeInteger(sourceSchemaVersion)||sourceSchemaVersion<89||sourceSchemaVersion>999)
  throw Error('POSTED_FINANCE_EXPORT_CONFIGURATION_REQUIRED');
 const resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config);
 const admit=createSessionRequestAdmission(config),database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 const includesExcess=sourceSchemaVersion>=91;
 const profile=includesExcess?excessReceiptExportProfile:postedFinanceExportProfile;
 const collect=createServiceRefundSourceCollector({businessId,environment,connectionString:config.exportConnectionString},includesExcess);
 let active=false;
 async function authorized<T>(credential:string,signal:AbortSignal,work:(args:unknown[],actorId:string)=>Promise<T>){
  const hash=sessionCredentialHash(credential);
  try{
   const session=await sessions.verify(credential,signal,'background',true);
   require(!signal.aborted);
   return await work([hash,session.sessionId,session.actorId,session.provider.issuer,session.provider.subject,
    session.provider.sessionId,new Date(session.provider.expiresAt),businessId],session.actorId);
  }finally{hash.fill(0);}
 }
 async function authorize(credential:string,signal:AbortSignal){
  return authorized(credential,signal,async(args,actorId)=>{
   const context=downloadObject(await database('SELECT crest_commands.authorize_posted_finance_export('+authority+') AS result',args,signal),
    ['schemaVersion','businessId','actorId','recoveryEpoch']);
   const recoveryEpoch=context.recoveryEpoch;
   require(context.schemaVersion===1&&context.businessId===businessId&&context.actorId===actorId&&customerUuid(recoveryEpoch));
   return {actorId,recoveryEpoch};
  });
 }
 return async (request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{
  let started=false,entered=false,archive:Uint8Array<ArrayBuffer>|undefined;
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(60000)]);
  try{
   resolve(request,peer);
   const url=new URL(request.url);
   if(url.search||url.hash||![postedFinanceExportPath,postedFinanceExportPath+'/context'].includes(url.pathname))return postedFinanceExportFailure(404);
   if(request.method!=='POST')return postedFinanceExportFailure(405);
   protect.requireOrigin(request);
   const bounded=new Request(request,{signal}),credential=readBrowserCookies(bounded.headers).session;
   require(credential);
   await readFlatJsonBody(bounded,[],32);
   await csrf(bounded,credential,signal);
   started=true;
   if(!await admit(credential,'ordinary',signal))return postedFinanceExportFailure(429);
   if(url.pathname.endsWith('/context')){
    await authorize(credential,signal);
    return privateJsonResponse({profile});
   }
   if(active)return postedFinanceExportFailure(429);
   active=true;entered=true;
   const first=await authorize(credential,signal);
   const capture=(await collect(signal)).forFinanceServer();
   require(capture.businessId===businessId&&capture.profile===profile&&!signal.aborted);
   const checked=verifyFinanceSourceExport(capture.manifest,capture.files,businessId);
   require(checked.profile===profile&&checked.verified);
   const observedAt:unknown=JSON.parse(capture.manifest).observedAt;
   require(typeof observedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(observedAt)
    &&Number.isFinite(Date.parse(observedAt))&&Date.parse(observedAt)<=Date.now());
   const manifestSha256=digest(capture.manifest);
   const provenance={schemaVersion:1,profile,businessId,observedAt,
    appReleaseId,sourceSchemaVersion,manifestSha256,completePortableExport:false,completeBackup:false};
   const entries=Object.fromEntries([...capture.files,{name:'manifest.json',content:capture.manifest},
    {name:'export_delivery.json',content:JSON.stringify(provenance,null,2)+'\n'}].map(file=>[file.name,Buffer.from(file.content)]));
   try{
    require(Object.keys(entries).length===checked.files+2&&Object.values(entries).reduce((sum,bytes)=>sum+bytes.length,0)<=postedFinanceExportLimit);
    archive=new Uint8Array(zipSync(entries));
   }finally{for(const bytes of Object.values(entries))bytes.fill(0);}
   require(archive.byteLength>0&&archive.byteLength<=postedFinanceExportLimit&&!signal.aborted);
   const archiveSha256=digest(archive),archiveBytes=archive.byteLength;
   const scope={profile,sourceSchemaVersion,appReleaseId,businessId,actorId:first.actorId,
    recoveryEpoch:first.recoveryEpoch,observedAt,manifestSha256,archiveSha256,archiveBytes};
   await authorized(credential,signal,async(args,actorId)=>{
    require(actorId===first.actorId);
    await database.commandTransaction(async(query,current)=>{
     const result=downloadObject(await query('SELECT crest_commands.record_posted_finance_export_access('+authority+
      ',$9::uuid,$10::integer,$11::text,$12::text,$13::text,$14::text,$15::integer) AS result',
      [...args,first.recoveryEpoch,sourceSchemaVersion,appReleaseId,observedAt,manifestSha256,archiveSha256,archiveBytes]),
      ['schemaVersion','state','operationId','auditEventId','recordedAt','scope']);
     const returnedScope=downloadObject(result.scope,Object.keys(scope));
     require(!current.aborted&&result.schemaVersion===1&&result.state==='authorized_handoff'&&customerUuid(result.operationId)
      &&customerUuid(result.auditEventId)&&customerInstant(result.recordedAt)
      &&Date.parse(result.recordedAt)>=Date.parse(observedAt)&&Date.parse(result.recordedAt)<=Date.now()
      &&Object.entries(scope).every(([key,value])=>returnedScope[key]===value));
    },signal);
   });
   require(!signal.aborted);
   const headers=new Headers(privateJsonResponse({}).headers);
   headers.set('Cache-Control','private, no-store, max-age=0, no-transform');
   headers.set('Content-Type','application/zip');
   headers.set('Content-Length',String(archiveBytes));
   headers.set('Content-Disposition','attachment; filename="'+postedFinanceExportName+'"');
   headers.set('X-Crest-SHA256',archiveSha256);
   const bytes=archive;
   let released=false;
   const release=()=>{if(released)return;released=true;bytes.fill(0);active=false;};
   const body=new ReadableStream<Uint8Array>({
    pull(stream){stream.enqueue(bytes);stream.close();},
    cancel(){release();},
   });
   const response=new Response(body,{headers});
   postedFinanceArchiveReleases.set(response,release);
   entered=false;
   archive=undefined;
   return response;
  }catch{return postedFinanceExportFailure(started?503:400);}
  finally{archive?.fill(0);if(entered)active=false;}
 };
}
const postedFinanceArchiveReleases=new WeakMap<Response,()=>void>();
export function discardPostedFinanceExport(response:Response){
 postedFinanceArchiveReleases.get(response)?.();
 postedFinanceArchiveReleases.delete(response);
}
