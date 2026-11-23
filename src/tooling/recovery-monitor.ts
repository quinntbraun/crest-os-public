// Independent hosted Healthchecks start/failure signals. A staged candidate is
// never a successful backup. Complete-point success signaling is separate work.
type Failure='capture'|'vault'|'verification'|'recovery_review'|'cancelled'|'deadline';
type Phase='fresh'|'started'|'start_unknown'|'failed'|'failure_unknown';
type Stage='configuration'|'request'|'dispatch'|'acknowledgment';
export class RecoveryMonitorError extends Error{readonly stage:Stage;constructor(stage:Stage){super('RECOVERY_MONITOR_REVIEW_REQUIRED');this.name='RecoveryMonitorError';this.stage=stage;}}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
function fields(value:unknown,names:readonly string[]):asserts value is Record<string,unknown>{require(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...names].sort().join(','));}
function instant(value:unknown):asserts value is string{require(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value);}
export function createRecoveryMonitorAttempt(privatePingUrl:string,run:Readonly<{runId:string;startedAt:string}>,send:typeof fetch=fetch){
 let endpoint:URL;
 try{
  require(typeof privatePingUrl==='string'&&privatePingUrl.length<=256&&typeof send==='function');endpoint=new URL(privatePingUrl);
  require(endpoint.href===privatePingUrl&&endpoint.protocol==='https:'&&endpoint.hostname==='hc-ping.com'&&!endpoint.port&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&uuid.test(endpoint.pathname.slice(1)));
  fields(run,['runId','startedAt']);require(typeof run.runId==='string'&&uuid.test(run.runId));instant(run.startedAt);
 }catch{throw new RecoveryMonitorError('configuration');}
 const identity=Object.freeze({...run}),ping=endpoint.href;let phase:Phase='fresh',busy=false,startAttempted=false,failureAttempted=false;
 async function signal(kind:'start'|'failure',time:string,category:Failure|undefined,external:AbortSignal){
  let stage:Stage='request',dispatched=false,entered=false;
  try{
   require(!busy);instant(time);require(Date.parse(time)>=Date.parse(identity.startedAt));external.throwIfAborted();
   require(kind==='start'?!startAttempted&&!failureAttempted:!failureAttempted);
   busy=true;entered=true;const signal=AbortSignal.any([external,AbortSignal.timeout(10000)]);
   const target=new URL(ping+'/'+(kind==='start'?'start':'fail'));target.searchParams.set('rid',identity.runId);
   const body=JSON.stringify({runId:identity.runId,at:time,...(category?{category}:{})});require(body.length<=256);
   if(kind==='start')startAttempted=true;else failureAttempted=true;
   stage='dispatch';dispatched=true;
   const response=await send(target,{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'content-type':'application/json'},body,signal});
   stage='acknowledgment';let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
   try{
    signal.throwIfAborted();require(response.status===200&&!response.redirected&&response.body);reader=response.body.getReader();let text='',size=0;
    for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done)break;require(part.value instanceof Uint8Array);size+=part.value.byteLength;require(size<=32);text+=new TextDecoder('utf-8',{fatal:true}).decode(part.value);}
    require(text==='OK');
   }finally{if(reader)await reader.cancel().catch(()=>{});else await response.body?.cancel().catch(()=>{});}
   phase=kind==='start'?'started':'failed';return Object.freeze({profile:'crest.backup-monitor-signal.v1' as const,runId:identity.runId,at:time,signal:kind,acknowledged:true as const,completeBackup:false as const});
  }catch{if(dispatched)phase=kind==='start'?'start_unknown':'failure_unknown';throw new RecoveryMonitorError(stage);}
  finally{if(entered)busy=false;}
 }
 return Object.freeze({
  async start(external:AbortSignal){return signal('start',identity.startedAt,undefined,external);},
  async fail(input:Readonly<{failedAt:string;category:Failure}>,external:AbortSignal){
   try{fields(input,['failedAt','category']);instant(input.failedAt);require(['capture','vault','verification','recovery_review','cancelled','deadline'].includes(input.category));}catch{throw new RecoveryMonitorError('request');}
   return signal('failure',input.failedAt,input.category,external);
  },
  view:()=>Object.freeze({runId:identity.runId,phase,busy,startAttempted,failureAttempted,completeBackup:false as const}),
  toJSON():never{throw new RecoveryMonitorError('configuration');},
 });
}
