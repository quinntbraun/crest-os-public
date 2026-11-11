'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {authentication} from '../../client/authentication';
import {conditionPhotoType,dropoffPhotos} from '../../client/dropoff-photos';
import {scheduling} from '../../client/scheduling';

type PickerProps=Readonly<{businessId:string;jobVehicleId:string;caseId:string;handoff:1|2;
 required:boolean;change:(selected:boolean,verifiedId:string|null)=>void}>;
export function DropoffPhotoPicker({businessId,jobVehicleId,caseId,handoff,required,change}:PickerProps){
 const id=useId(),input=useRef<HTMLInputElement>(null),request=useRef<AbortController|null>(null);
 const [selection,setSelection]=useState<{file:File;type:string;photoId:string}|null>(null);
 const [status,setStatus]=useState({busy:false,verified:false,failed:false,message:''});
 useEffect(()=>()=>request.current?.abort(),[]);
 function clear(){
  if(input.current)input.current.value='';
  setSelection(null);setStatus({busy:false,verified:false,failed:false,message:''});change(false,null);
 }
 async function act(action:'upload'|'status'|'verify'){
  if(!selection||request.current||status.verified)return;
  const selected=selection,active=new AbortController();request.current=active;
  setStatus({busy:true,verified:false,failed:false,message:action==='upload'?'Uploading condition photo…':'Checking the saved photo…'});
  try{
   const proof=await authentication.session(active.signal),scope={jobVehicleId,photoId:selected.photoId};
   if(action==='upload'){
    const workspace=await scheduling.workspace(proof,active.signal);
    if(workspace.context.businessId!==businessId||workspace.context.writeState!=='ready')throw Error();
    await dropoffPhotos.reserve(proof,active.signal,{...scope,caseId,handoff,epoch:workspace.context.recoveryEpoch,
     contentType:selected.type,byteSize:selected.file.size});
    await dropoffPhotos.upload(proof,active.signal,scope,selected.file,selected.type);
    if(!active.signal.aborted)setStatus({busy:true,verified:false,failed:false,message:'Verifying the uploaded photo…'});
   }
   const state=await dropoffPhotos.status(proof,active.signal,scope,action!=='status');
   active.signal.throwIfAborted();
   if(state==='verified'){
    setStatus({busy:false,verified:true,failed:false,message:'Photo verified. Save the handoff to link it.'});
    change(true,selected.photoId);
   }else setStatus({busy:false,verified:false,failed:true,message:state==='pending'?
    'The photo is pending. Check the staged upload or upload the selected file again.':'No reservation was found. Upload the selected file again.'});
  }catch{
   if(!active.signal.aborted)setStatus({busy:false,verified:false,failed:true,message:
    'The photo could not be confirmed. Check photo status before saving the handoff.'});
  }finally{if(request.current===active)request.current=null;}
 }
 return <div className="custody-photo-controls">
  <label htmlFor={id}>Condition photo{required?' (required)':' (optional)'}</label>
  <input id={id} ref={input} type="file" accept="image/jpeg,image/png,image/heic,.heic" disabled={status.busy||status.verified}
   aria-describedby={id+'-help'} onChange={event=>{
    const file=event.target.files?.[0];
    if(!file){clear();return;}
    const type=conditionPhotoType(file);
    if(!type){clear();setStatus({busy:false,verified:false,failed:false,message:'Choose a JPEG, PNG or HEIC photo up to 25 MB.'});return;}
    setSelection({file,type,photoId:crypto.randomUUID()});
    setStatus({busy:false,verified:false,failed:false,message:'Photo selected. Upload it to verify the original.'});
    change(true,null);
   }}/>
  <p className="field-help" id={id+'-help'}>JPEG, PNG or HEIC, up to 25 MB. Crest keeps the original.</p>
  {status.message&&<p role="status" aria-label="Condition photo status">{status.message}</p>}
  {selection&&<>
   {!status.verified&&<button type="button" className="secondary" disabled={status.busy} onClick={()=>void act('upload')}>
    {status.failed?'Upload selected photo again':'Upload and verify photo'}
   </button>}
   {status.failed&&<>
    <button type="button" className="secondary" onClick={()=>void act('status')}>Check photo status</button>
    <button type="button" className="secondary" onClick={()=>void act('verify')}>Check staged upload</button>
   </>}
   <button type="button" className="secondary" disabled={status.busy} onClick={clear}>Remove photo from this handoff</button>
  </>}
 </div>;
}

export function DropoffPhotoViewer({jobVehicleId,photoId}:{jobVehicleId:string;photoId:string}){
 const [preview,setPreview]=useState(''),[message,setMessage]=useState('');
 const [busy,setBusy]=useState<'preview'|'original'|null>(null);
 const [original,setOriginal]=useState<{url:string;name:string}|null>(null);
 const request=useRef<AbortController|null>(null),objectUrl=useRef('');
 const originalUrl=useRef(''),expiry=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>{
  request.current?.abort();
  if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);
  if(originalUrl.current)URL.revokeObjectURL(originalUrl.current);
  clearTimeout(expiry.current);
 },[]);
 function clearOriginal(){
  if(originalUrl.current)URL.revokeObjectURL(originalUrl.current);
  originalUrl.current='';clearTimeout(expiry.current);setOriginal(null);
 }
 async function open(variant:'preview'|'original'){
  if(request.current)return;
  const active=new AbortController();request.current=active;setBusy(variant);setMessage('');
  try{
   const proof=await authentication.session(active.signal);
   const file=await dropoffPhotos.file(proof,active.signal,{jobVehicleId,photoId},variant);
   active.signal.throwIfAborted();
   const url=URL.createObjectURL(file.blob);
   if(variant==='preview'){objectUrl.current=url;setPreview(url);}
   else{
    clearOriginal();originalUrl.current=url;setOriginal({url,name:file.name});
    setMessage('The original is ready to save.');
    expiry.current=setTimeout(()=>{clearOriginal();setMessage('The download expired. Prepare it again to save the original.');},60000);
   }
  }catch{if(!active.signal.aborted)setMessage(variant==='preview'?'The photo could not be opened. Try again.':'The original could not be prepared. Try again.');}
  finally{if(request.current===active){request.current=null;if(!active.signal.aborted)setBusy(null);}}
 }
 function close(){
  if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);
  objectUrl.current='';setPreview('');
 }
 return <div className="custody-photo-controls">
  {preview?<><button type="button" className="secondary" onClick={close}>Close condition photo</button>
   {/* The authenticated derivative is an ephemeral local blob URL. */}
   <img className="custody-photo-preview" src={preview} alt="Saved vehicle condition photo"/></>:
   <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void open('preview')}>{busy==='preview'?'Opening photo…':'View condition photo'}</button>}
  {original?<a className="custody-photo-save" href={original.url} download={original.name}
   onClick={()=>setMessage('Download requested. Check your browser downloads.')}>Save original file</a>:
   <button type="button" className="secondary" disabled={busy!==null} onClick={()=>void open('original')}>
    {busy==='original'?'Preparing original…':'Prepare original download'}</button>}
  {message&&<p role="status">{message}</p>}
 </div>;
}
