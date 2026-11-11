import type {Proof} from './authentication';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';

const prefix='/api/business/scheduling/custody-photo/';
const limit=25*1024*1024;
type Scope=Readonly<{jobVehicleId:string;photoId:string}>;
const types=['image/jpeg','image/png','image/heic'];
export function conditionPhotoType(file:File){
 const extension=file.name.split('.').pop()?.toLowerCase();
 const type=file.type||({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',heic:'image/heic'} as Record<string,string>)[extension??''];
 return type&&types.includes(type)&&file.size>0&&file.size<=limit?type:null;
}

function request(route:string,proof:Proof,signal:AbortSignal,body:BodyInit,headers:Record<string,string>){
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(40000)]);
 return fetch(prefix+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
  referrerPolicy:'no-referrer',body,signal:bounded,headers:{...headers,'x-crest-csrf':proof.csrfToken}});
}
async function json(route:string,proof:Proof,signal:AbortSignal,scope:Scope,body:BodyInit,headers:Record<string,string>):Promise<unknown>{
 const response=await request(route,proof,signal,body,headers);
 if(!response.ok||!response.headers.get('cache-control')?.includes('no-store')||
  !response.headers.get('content-type')?.startsWith('application/json'))throw Error('DROPOFF_PHOTO_UNCONFIRMED');
 const value:unknown=await response.json();
 if(!value||typeof value!=='object'||!('photoId'in value)||value.photoId!==scope.photoId)throw Error('DROPOFF_PHOTO_UNCONFIRMED');
 return value;
}
const jsonHeader={'content-type':'application/json'};
export const dropoffPhotos=Object.freeze({
 async reserve(proof:Proof,signal:AbortSignal,input:Scope&{epoch:string;caseId:string;handoff:1|2;contentType:string;byteSize:number}){
  const value=await json('reserve',proof,signal,input,JSON.stringify(input),jsonHeader);
  if(!exact(value,['photoId']))throw Error('DROPOFF_PHOTO_UNCONFIRMED');
 },
 async upload(proof:Proof,signal:AbortSignal,scope:Scope,file:File,type:string){
  const value=await json('upload',proof,signal,scope,file,{'content-type':type,
   'x-crest-job-vehicle':scope.jobVehicleId,'x-crest-photo':scope.photoId});
  if(!exact(value,['photoId','state'])||value.state!=='uploaded')throw Error('DROPOFF_PHOTO_UNCONFIRMED');
 },
 async status(proof:Proof,signal:AbortSignal,scope:Scope,verify=false){
  const value=await json(verify?'verify':'status',proof,signal,scope,JSON.stringify(scope),jsonHeader);
  if(!exact(value,['photoId','state'])||(value.state!=='pending'&&value.state!=='verified'&&value.state!=='absent')||
   (verify&&value.state!=='verified'))throw Error('DROPOFF_PHOTO_UNCONFIRMED');
  return value.state;
 },
 async file(proof:Proof,signal:AbortSignal,scope:Scope,variant:'preview'|'original'){
  const response=await request('file',proof,signal,JSON.stringify({...scope,variant}),jsonHeader);
  const type=response.headers.get('content-type')??'',rawLength=response.headers.get('content-length')??'';
  const size=Number(rawLength);
  if(!response.ok||!response.headers.get('cache-control')?.includes('no-store')||
   (variant==='preview'?type!=='image/jpeg':!types.includes(type))||!/^[1-9]\d*$/.test(rawLength)||
   !Number.isSafeInteger(size)||size>(variant==='preview'?8*1024*1024:limit))throw Error('DROPOFF_PHOTO_UNCONFIRMED');
  const extension=type==='image/png'?'png':type==='image/heic'?'heic':'jpg';
  const name=`condition-${scope.photoId}${variant==='preview'?'-preview':''}.${extension}`;
  if(response.headers.get('content-disposition')!==`attachment; filename="${name}"`)throw Error('DROPOFF_PHOTO_UNCONFIRMED');
  const reader=response.body?.getReader();
  if(!reader)throw Error('DROPOFF_PHOTO_UNCONFIRMED');
  const bytes=new Uint8Array(size);let offset=0;
  try{
   while(true){
    signal.throwIfAborted();
    const part=await reader.read();
    if(part.done)break;
    if(offset+part.value.byteLength>size)throw Error('DROPOFF_PHOTO_UNCONFIRMED');
    bytes.set(part.value,offset);offset+=part.value.byteLength;
   }
   signal.throwIfAborted();
   if(offset!==size)throw Error('DROPOFF_PHOTO_UNCONFIRMED');
   return {blob:new Blob([bytes],{type}),name};
  }finally{bytes.fill(0);void reader.cancel().catch(()=>undefined);reader.releaseLock();}
 }
});
