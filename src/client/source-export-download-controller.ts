import {authentication} from './authentication';
import {sourceExportOwnerContext} from './source-exports';
import {parseSourceExportOwnerContext} from '../security/source-export-owner-context';
import type {SourceExportOwnerContext} from '../security/source-export-owner-context';
import {createSourceExportDownloadClient,SourceExportDownloadClientError} from './source-export-downloads';
import {createSourceExportInventoryBuilder} from './source-export-download-inventory';
import type {SourceExportDownloadInventory} from './source-export-download-inventory';
import {createSourceExportLocalVerifier} from './source-export-local-files';
import {createSourceExportBrowserSave} from './source-export-browser-save';
import {customerUuid as uuid} from '../customer/customer-contract';

type Comparison=Awaited<ReturnType<ReturnType<typeof createSourceExportLocalVerifier>['verify']>>;
export type SourceExportDownloadView=Readonly<{phase:'idle'|'ready'|'prepared'|'requested'|'review'|'unavailable';message:string;busy:boolean;loaded:number;total:number|null;files:readonly Readonly<{partId:string;fileName:string;bytes:number;comparison:'unchecked'|'matching'|'missing'|'invalid'}>[];extraCount:number;canLoad:boolean;canContinue:boolean;canPrepare:boolean;canCompare:boolean;canRequestSave:boolean;prepared:Readonly<{fileName:string;bytes:number;expiresAt:number;state:'prepared'|'requested'}>|null}>;
export const initialSourceExportDownloadView:SourceExportDownloadView=Object.freeze({phase:'idle',message:'Load the file list before downloading this export.',busy:false,loaded:0,total:null,files:Object.freeze([]),extraCount:0,canLoad:true,canContinue:false,canPrepare:false,canCompare:false,canRequestSave:false,prepared:null});
type Dependencies={jobId:string;change:(view:SourceExportDownloadView)=>void;session?:typeof authentication.session;context?:typeof sourceExportOwnerContext;api?:typeof createSourceExportDownloadClient;save?:typeof createSourceExportBrowserSave;local?:typeof createSourceExportLocalVerifier};
export function createSourceExportDownloadController(deps:Dependencies){
 if(!uuid(deps.jobId))throw Error('SOURCE_EXPORT_DOWNLOAD_REVIEW_REQUIRED');
 const session=deps.session??authentication.session,readContext=deps.context??sourceExportOwnerContext,apiFactory=deps.api??createSourceExportDownloadClient,saveFactory=deps.save??createSourceExportBrowserSave,localFactory=deps.local??createSourceExportLocalVerifier;
 let alive=true,active:AbortController|null=null,context:SourceExportOwnerContext|undefined,builder:ReturnType<typeof createSourceExportInventoryBuilder>|undefined,inventory:SourceExportDownloadInventory|undefined,api:ReturnType<typeof createSourceExportDownloadClient>|undefined,save:ReturnType<typeof createSourceExportBrowserSave>|undefined,local:ReturnType<typeof createSourceExportLocalVerifier>|undefined,comparison:Comparison|undefined,phase:SourceExportDownloadView['phase']='idle',message=initialSourceExportDownloadView.message;
 function live(signal:AbortSignal){if(!alive||signal.aborted)throw Error();}
 function reset(){builder?.dispose();builder=undefined;inventory=undefined;api=undefined;context=undefined;local?.dispose();local=undefined;comparison=undefined;save?.clear();}
 function view():SourceExportDownloadView{
  const prepared=save?.view()??null,result=comparison?.forLocalFileComparison(),matches=new Set(result?.matchedPartIds??[]),missing=new Set(result?.missingPartIds??[]),progress=builder?.progress(),usable=alive&&!!inventory&&!['review','unavailable'].includes(phase);
  return Object.freeze({phase,message:phase==='prepared'&&!prepared?'The prepared copy expired. Prepare the file again before saving.':message,busy:!!active,loaded:progress?.loaded??0,total:progress?.total??null,files:Object.freeze(usable?inventory!.files.map(f=>Object.freeze({partId:f.partId,fileName:f.fileName,bytes:f.bytes,comparison:!result?'unchecked' as const:matches.has(f.partId)?'matching' as const:missing.has(f.partId)?'missing' as const:'invalid' as const})):[]),extraCount:result?.extraCount??0,canLoad:alive&&!active,canContinue:alive&&!active&&!!builder&&!inventory&&phase==='ready',canPrepare:usable&&!active,canCompare:usable&&!active,canRequestSave:usable&&!active&&prepared?.state==='prepared',prepared:usable?prepared:null});
 }
 function emit(){if(alive)deps.change(view());}
 async function fresh(signal:AbortSignal){
  const issued=await session(signal);live(signal);const proof=Object.freeze({csrfToken:issued.csrfToken,expiresAt:issued.expiresAt}),next=parseSourceExportOwnerContext(await readContext(proof,signal));live(signal);
  if(!Number.isSafeInteger(proof.expiresAt)||proof.expiresAt<=Date.now()||next.writeState!=='ready'||context&&JSON.stringify(next)!==JSON.stringify(context))throw Error();
  context=next;api??=apiFactory(next.businessId);return proof;
 }
 async function run(work:(signal:AbortSignal)=>Promise<void>){
  if(!alive||active)return;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);active=controller;emit();
  try{await work(signal);}catch(error){if(alive&&active===controller){save?.clear();if(error instanceof SourceExportDownloadClientError&&error.kind==='limited'&&builder&&!inventory){phase='ready';message='The file list is temporarily limited. Continue loading later; the checked position has been kept.';}else{reset();phase='unavailable';message='The export could not be verified. Check your sign-in and load the file list again.';}}}
  finally{if(active===controller){active=null;emit();}}
 }
 async function pages(signal:AbortSignal){
  while(builder?.request()){
   const proof=await fresh(signal),request=builder.request();if(!request)throw Error();const page=await api!.catalogue(request,proof,signal,builder.pinnedHeader());live(signal);builder.append(page);emit();
  }
  if(!builder||!context)throw Error();inventory=builder.snapshot().forDownloadInventory();local=localFactory(context.businessId,inventory);phase='ready';message='The complete file list is checked. Prepare and save one file at a time, then select your local copies to compare them.';
 }
 return Object.freeze({view,
  load:()=>run(async signal=>{reset();phase='idle';message='Checking sign-in and the file list…';const proof=await fresh(signal);live(signal);builder=createSourceExportInventoryBuilder(context!.businessId,deps.jobId);const page=await api!.catalogue(builder.request(),proof,signal);live(signal);builder.append(page);await pages(signal);}),
  continueLoading(){if(!view().canContinue)return Promise.resolve();return run(pages);},
  prepare(partId:string){if(!view().canPrepare)return Promise.resolve();const file=inventory?.files.find(f=>f.partId===partId);if(!file)return Promise.resolve();return run(async signal=>{
   save?.clear();const proof=await fresh(signal);live(signal);save??=saveFactory(emit);await api!.receive(inventory!.header,file,proof,signal,async(value,consumerSignal)=>{live(signal);await save!.prepare(value,consumerSignal,proof.expiresAt);live(signal);});live(signal);phase='prepared';message='The file bytes are checked. Request the browser save, then compare the local copy. This does not confirm it was saved.';
  });},
  requestSave(){if(!view().canRequestSave)return;try{save!.request(new AbortController().signal);phase='requested';message='Browser save requested. Select the resulting local file to compare its bytes; saving has not been confirmed.';}catch{save?.clear();phase='ready';message='The browser save could not be requested. Prepare the file again.';}emit();},
  compare(files:readonly File[]){if(!view().canCompare)return Promise.resolve();return run(async signal=>{comparison=undefined;save?.clear();const result=await local!.verify(files,signal);live(signal);comparison=result;const value=result.forLocalFileComparison();phase='ready';message=value.state==='matching'?'All selected file bytes match this export. This is not a complete backup or proof of durable storage.':'Some local files are missing, damaged, duplicated or unrelated. Review the results and explicitly prepare only the parts you need.';});},
  reviewOnReturn(){if(!alive)return;active?.abort();active=null;reset();phase='review';message='Load the file list again after returning to this tab. Prepared copies and previous comparisons were cleared.';emit();},
  dispose(){alive=false;active?.abort();active=null;reset();save?.dispose();save=undefined;}
 });
}
