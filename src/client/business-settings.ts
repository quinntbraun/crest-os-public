import type {Proof} from './authentication';
export const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const binding=/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
export type Rename=Readonly<{schemaVersion:1;operationId:string;recoveryEpoch:string;expectedVersion:string;legalName:string}>;
export type Settings=Readonly<{schemaVersion:1;businessId:string;legalName:string;businessVersion:string}&({writeState:'ready';recoveryEpoch:string}|{writeState:'paused';recoveryEpoch:null})>;
export type Snapshot=Readonly<{context:Settings;binding:string}>;
export type Committed=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:Readonly<{schemaVersion:1;businessId:string;businessVersion:string;auditEventId:string}>}>;
export type RenameResult=Committed|Readonly<{state:'conflict';reason:'version';currentVersion:string}|{state:'conflict';reason:'operation'}>;
type Kind='input'|'not_submitted'|'denied'|'recovery'|'limited'|'unknown'|'unavailable';
export class BusinessSettingsError extends Error{readonly kind:Kind;constructor(kind:Kind){super('BUSINESS_SETTINGS_FAILED');this.name='BusinessSettingsError';this.kind=kind;}}
export function exact(value:unknown,fields:string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));}
export function version(value:unknown):value is string{return typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;}
export function legalName(value:unknown):value is string{return typeof value==='string'&&value.length<=400&&[...value].length<=200&&!!value.replace(/^ +| +$/g,'')&&![...value].some(c=>{const n=c.codePointAt(0)??0;return n===0||n>=0xd800&&n<=0xdfff;});}
export function renameInput(value:unknown):value is Rename{return exact(value,['schemaVersion','operationId','recoveryEpoch','expectedVersion','legalName'])&&value.schemaVersion===1
  &&typeof value.operationId==='string'&&uuid.test(value.operationId)&&typeof value.recoveryEpoch==='string'&&uuid.test(value.recoveryEpoch)&&version(value.expectedVersion)&&legalName(value.legalName);}
function committed(value:unknown,businessId:string,command:Rename):Committed{
  if(!exact(value,['state','operationId','recoveryEpoch','receipt'])||value.state!=='committed'||value.operationId!==command.operationId||value.recoveryEpoch!==command.recoveryEpoch
    ||!exact(value.receipt,['schemaVersion','businessId','businessVersion','auditEventId']))throw new BusinessSettingsError('unknown');
  const r=value.receipt;if(r.schemaVersion!==1||r.businessId!==businessId||!version(r.businessVersion)||BigInt(r.businessVersion)!==BigInt(command.expectedVersion)+1n||typeof r.auditEventId!=='string'||!uuid.test(r.auditEventId))throw new BusinessSettingsError('unknown');
  return Object.freeze({state:'committed',operationId:command.operationId,recoveryEpoch:command.recoveryEpoch,receipt:Object.freeze({schemaVersion:1,businessId,businessVersion:r.businessVersion,auditEventId:r.auditEventId})});
}
async function post(path:'settings'|'rename'|'operation',body:object,proof:Proof,external:AbortSignal){
  try{
    const signal=AbortSignal.any([external,AbortSignal.timeout(45000)]);
    const response=await fetch('/api/business/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
      headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body),signal});
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')||!response.headers.get('cache-control')?.includes('no-store'))throw new Error();
    const reader=response.body?.getReader();if(!reader)throw new Error();let size=0;const parts:Uint8Array[]=[];
    try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
      const abort=()=>reject(new Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.byteLength===0||(size+=part.value.byteLength)>8192)throw new Error();parts.push(part.value);}}
    finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();}
    if(signal.aborted)throw new Error();const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const fields=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).length:0;
    const nested=exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.receipt&&typeof value.receipt==='object'&&!Array.isArray(value.receipt)?Object.keys(value.receipt).length:0;
    if((new TextDecoder('utf-8',{fatal:true}).decode(bytes).match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length!==fields+nested)throw new Error();
    if(exact(value,['error'])){
      const codes:Record<string,[number,Kind]>={BUSINESS_RENAME_INPUT_REQUIRED:[400,'input'],BUSINESS_RENAME_NOT_SUBMITTED:[503,'not_submitted'],BUSINESS_RENAME_DENIED:[403,'denied'],RECOVERY_REVIEW_REQUIRED:[409,'recovery'],BUSINESS_REQUEST_LIMITED:[429,'limited'],BUSINESS_RENAME_OUTCOME_UNKNOWN:[503,'unknown']};
      const match=typeof value.error==='string'?codes[value.error]:undefined;if(match&&response.status===match[0])throw new BusinessSettingsError(match[1]);
      throw new BusinessSettingsError(path==='rename'?'unknown':'unavailable');
    }
    return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding')};
  }catch(error){throw error instanceof BusinessSettingsError?error:new BusinessSettingsError('unknown');}
}
export const businessSettings=Object.freeze({
  async settings(proof:Proof,signal:AbortSignal):Promise<Snapshot>{
    const result=await post('settings',{},proof,signal),v=result.value;
    if(result.status!==200||typeof result.binding!=='string'||!binding.test(result.binding)||!exact(v,['schemaVersion','businessId','legalName','businessVersion','writeState','recoveryEpoch'])
      ||v.schemaVersion!==1||typeof v.businessId!=='string'||!uuid.test(v.businessId)||!legalName(v.legalName)||!version(v.businessVersion)
      ||!(v.writeState==='ready'&&typeof v.recoveryEpoch==='string'&&uuid.test(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null))throw new BusinessSettingsError('unknown');
    return Object.freeze({context:Object.freeze({...v}) as Settings,binding:result.binding});
  },
  async rename(businessId:string,command:Rename,proof:Proof,signal:AbortSignal):Promise<RenameResult>{
    if(!uuid.test(businessId)||!renameInput(command))throw new BusinessSettingsError('input');
    const result=await post('rename',Object.freeze({...command}),proof,signal),v=result.value;
    if(result.status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&v.reason==='operation')return Object.freeze({state:'conflict',reason:'operation'});
    if(result.status===409&&exact(v,['state','reason','currentVersion'])&&v.state==='conflict'&&v.reason==='version'&&version(v.currentVersion))return Object.freeze({state:'conflict',reason:'version',currentVersion:v.currentVersion});
    if(result.status!==200)throw new BusinessSettingsError('unknown');return committed(v,businessId,command);
  },
  async lookup(businessId:string,command:Rename,proof:Proof,signal:AbortSignal):Promise<Committed|Readonly<{state:'absent'}>>{
    if(!uuid.test(businessId)||!renameInput(command))throw new BusinessSettingsError('input');const result=await post('operation',{operationId:command.operationId},proof,signal);
    if(result.status!==200)throw new BusinessSettingsError('unknown');if(exact(result.value,['state'])&&result.value.state==='absent')return Object.freeze({state:'absent'});return committed(result.value,businessId,command);
  }
});
