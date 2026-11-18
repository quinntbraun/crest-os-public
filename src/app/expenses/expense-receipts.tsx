'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {ExpenseRevision} from '../../bookkeeping/expenses/expense-contract';
import type {ReceiptView} from '../../bookkeeping/expenses/receipt-contract';
import type {ExpenseContext} from '../../client/expenses';
import type {PendingReceipt} from '../../client/pending-receipt';
import type {createReceiptClient,ReceiptAttempt} from '../../client/expense-receipts';
import {ReceiptDocumentViewer} from './receipt-document-viewer';
type Resume=Readonly<{context:ExpenseContext;receipt:ReceiptView;operationId:string;file?:File}>;
export function ExpenseReceipts({expense,context,client,visible=true}:{expense:ExpenseRevision;context:ExpenseContext;client:ReturnType<typeof createReceiptClient>;visible?:boolean}){
 const [rows,setRows]=useState<readonly ReceiptView[]>([]),[file,setFile]=useState<File|null>(null),[pending,setPending]=useState<ReceiptAttempt|null>(null),[resuming,setResuming]=useState<Resume|null>(null),[original,setOriginal]=useState<PendingReceipt|null>(null),[storageBlocked,setStorageBlocked]=useState(true),[canRetry,setCanRetry]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[inputKey,setInputKey]=useState(0);
 const [preview,setPreview]=useState<{receiptId:string;url:string}|null>(null);
 const previewFigure=useRef<HTMLElement|null>(null),closeButton=useRef<HTMLButtonElement|null>(null);
 const previewUrl=useRef<string|null>(null),previewGeneration=useRef(0),previewTrigger=useRef<HTMLButtonElement|null>(null);
 const mounted=useRef(false),generation=useRef(0),active=useRef<AbortController|null>(null),lock=useRef(false);
 const clearPreviewUrl=useCallback(()=>{
  previewGeneration.current++;
  if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);
  previewUrl.current=null;
 },[]);
 const closePreview=useCallback(()=>{clearPreviewUrl();setPreview(null);},[clearPreviewUrl]);
 useEffect(()=>{if(!visible)queueMicrotask(closePreview);},[visible,closePreview]);
 useEffect(()=>{
  if(!visible||!preview)return;
  previewFigure.current?.scrollIntoView({block:'nearest'});
  closeButton.current?.focus({preventScroll:true});
 },[visible,preview]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(pending||resuming){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[pending,resuming]);
 useEffect(()=>{
  mounted.current=true;const token=++generation.current;lock.current=false;
  const reset=()=>{closePreview();setRows([]);setFile(null);setPending(null);setResuming(null);setCanRetry(false);setBusy(false);setInputKey(k=>k+1);try{const saved=client.pending();setOriginal(saved);setStorageBlocked(false);setStatus(saved?'An interrupted receipt request needs confirmation before another upload.':'');}catch{setOriginal(null);setStorageBlocked(true);setStatus('Receipt recovery storage needs review. New uploads are blocked.');}};
  queueMicrotask(()=>{if(mounted.current&&generation.current===token)reset();});
  const invalidate=()=>{generation.current++;active.current?.abort();active.current=null;},hide=()=>{invalidate();lock.current=false;reset();},visibility=()=>{if(document.visibilityState==='hidden')hide();};
  window.addEventListener('pagehide',hide);document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;invalidate();clearPreviewUrl();window.removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',visibility);};
 },[client,context.businessId,context.binding,context.recoveryEpoch,expense.expenseId,expense.revision,clearPreviewUrl,closePreview]);
 function refreshOriginal(){try{const saved=client.pending();setOriginal(saved);setStorageBlocked(false);return saved;}catch{setStorageBlocked(true);setStatus('Receipt recovery storage needs review. New uploads are blocked.');return undefined;}}
 async function run(work:(current:()=>boolean,signal:AbortSignal)=>Promise<void>){if(lock.current||!mounted.current||document.visibilityState==='hidden')return;const token=generation.current,controller=new AbortController(),current=()=>mounted.current&&generation.current===token&&!controller.signal.aborted&&document.visibilityState!=='hidden';active.current=controller;lock.current=true;setBusy(true);try{await work(current,controller.signal);}catch{if(current())setStatus('Could not confirm the receipt request. Keep its original reference.');}finally{if(active.current===controller){active.current=null;lock.current=false;if(current()){refreshOriginal();setBusy(false);}}}}
 function show(row:ReceiptView){setRows(rows=>[...rows.filter(r=>r.receiptId!==row.receiptId),row]);}
 function clearPrivateAttempt(){setPending(null);setResuming(null);setFile(null);setCanRetry(false);setInputKey(k=>k+1);}
 async function attach(attempt:ReceiptAttempt){await run(async(current,signal)=>{try{const receipt=await client.attach(attempt,current,signal);if(!current())return;show(receipt);clearPrivateAttempt();setStatus('Receipt saved and checked.');}catch{if(current()){const saved=refreshOriginal();setCanRetry(saved===null);if(saved!==undefined)setStatus(saved?'Receipt outcome is unknown. Check its original request before retrying.':'Attachment is unfinished. Retry the same attachment to check its saved receipt and continue.');}}});}
 async function resume(attempt:Resume){await run(async(current,signal)=>{try{const receipt=await client.resume(attempt.context,attempt.receipt,attempt.operationId,attempt.file,current,signal);if(!current())return;show(receipt);clearPrivateAttempt();setStatus('Saved receipt recovered and checked.');}catch{if(current()){const saved=refreshOriginal();setCanRetry(saved===null);if(saved!==undefined)setStatus(saved?'Saved upload still needs confirmation. Check its original request before retrying.':'Saved upload is unfinished. Retry the same saved upload to check and continue.');}}});}
 const originalHere=original?.businessId===context.businessId&&original.reference.expenseId===expense.expenseId;
 async function checkOriginal(){if(!originalHere)return;await run(async(current,signal)=>{const result=await client.recover(context,current,signal);if(!current())return;if(result.state==='committed'){show(result.receipt);clearPrivateAttempt();setStatus(result.receipt.status==='available'?'Original receipt publication confirmed.':'Original receipt reservation confirmed. Use its saved upload to continue.');}else if(result.state==='absent'){const attempt=pending??resuming;setCanRetry(!!attempt&&attempt.context.binding===original?.binding&&attempt.context.recoveryEpoch===original?.reference.recoveryEpoch&&context.binding===original?.binding&&context.recoveryEpoch===original?.reference.recoveryEpoch&&context.writeState==='ready');setStatus(attempt?'No original is recorded. Retry only the same still-open attachment.':'No original is recorded. The previous file is gone; keep this reference for original-request review. New uploads stay blocked.');}else{clearPrivateAttempt();setStatus('No interrupted receipt reference remains in this tab.');}});}
 const writesBlocked=busy||storageBlocked||!!original||!!pending||!!resuming||expense.payload.voided||context.writeState!=='ready';
 function startResume(row:ReceiptView,useFile=false){if(writesBlocked)return;if(useFile&&(!file||file.type!==row.declaredType||file.size!==row.byteSize)){setStatus('Choose the original file with the recorded type and size.');return;}const attempt:Resume=Object.freeze({context,receipt:row,operationId:crypto.randomUUID(),...(useFile&&file?{file}:{})});setResuming(attempt);void resume(attempt);}
 function resumeWithFile(){if(!canRetry||!resuming||!file)return;if(file.type!==resuming.receipt.declaredType||file.size!==resuming.receipt.byteSize){setStatus('Choose the original file with the recorded type and size.');return;}const attempt=Object.freeze({...resuming,file});setResuming(attempt);void resume(attempt);}
 async function begin(){if(!file||writesBlocked)return;const attempt:ReceiptAttempt=Object.freeze({context,expenseId:expense.expenseId,expenseRevision:expense.revision,receiptId:crypto.randomUUID(),reserveOperationId:crypto.randomUUID(),publishOperationId:crypto.randomUUID(),file});setPending(attempt);await attach(attempt);}
 async function download(row:ReceiptView,variant:'original'|'preview'){await run(async(current,signal)=>{const result=await client.download(context,row,variant,current,signal);if(!current())return;const url=URL.createObjectURL(result.blob),a=document.createElement('a');a.href=url;a.download=result.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);if(current())setStatus('Downloaded a private receipt file.');});}
 async function openPreview(row:ReceiptView){
  closePreview();
  const requested=previewGeneration.current;
  setStatus('Loading verified receipt preview…');
  await run(async(current,signal)=>{
   try{
    const result=await client.download(context,row,'preview',current,signal);
    if(!current()||previewGeneration.current!==requested)return;
    if(result.blob.type!=='image/jpeg')throw new Error();
    const url=URL.createObjectURL(result.blob);
    previewUrl.current=url;
    setPreview({receiptId:row.receiptId,url});
    setStatus('Verified receipt preview loaded.');
   }catch{
    if(current()&&previewGeneration.current===requested)setStatus('The receipt preview could not be verified. Try opening it again.');
   }
  });
 }
 const fileDisabled=busy||storageBlocked||!!pending||!!resuming?.file||!!original&&!canRetry||expense.payload.voided||context.writeState!=='ready';
 return <details className="expense-receipts" onToggle={event=>{if(event.target===event.currentTarget&&!event.currentTarget.open)closePreview();}}>
  <summary>Receipts</summary>
  <div className="receipt-layout" data-preview={preview!==null}>
   <div className="receipt-controls"><p>Attach a JPEG, PNG, HEIC or PDF up to 25 MB. Files stay private; attachment does not change the expense amount.</p>
  {original&&<section aria-label="Interrupted receipt request"><p>{originalHere?'Check the original request before another attachment.':'Another receipt request in this tab needs review before new uploads.'}</p>{originalHere&&<><p>Receipt reference: <code>{original.reference.receiptId}</code></p><button type="button" className="secondary" disabled={busy} onClick={()=>void checkOriginal()}>Check interrupted receipt</button></>}<a href={original.reference.expectedRevision==='0'?'/save-review?kind=bookkeeping.receipt.reserve':'/save-review?kind=bookkeeping.receipt.publish'}>Review interrupted receipt request</a></section>}
  <label className="receipt-file">Receipt file<input key={inputKey} type="file" accept="image/jpeg,image/png,image/heic,application/pdf" disabled={fileDisabled} onChange={e=>{const selected=e.target.files?.[0]??null;if(selected&&(!['image/jpeg','image/png','image/heic','application/pdf'].includes(selected.type)||selected.size<1||selected.size>25*1024*1024)){e.target.value='';setFile(null);setStatus('Choose a supported file between 1 byte and 25 MB.');return;}setFile(selected);setStatus('');}}/></label>
  {file&&<p className="receipt-file-name">{file.name} · {Math.ceil(file.size/1024)} KB</p>}
  <div className="receipt-actions">
   <button type="button" disabled={!file||writesBlocked} onClick={()=>void begin()}>Attach receipt</button>
   {file&&!fileDisabled&&<button type="button" className="secondary" onClick={()=>{setFile(null);setInputKey(key=>key+1);}}>Clear selected file</button>}
  </div>
  <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async(current,signal)=>{const saved=await client.list(context,expense.expenseId,current,signal);if(!current())return;setRows(saved);if(preview&&!saved.some(row=>row.receiptId===preview.receiptId))closePreview();setStatus('Saved receipt list refreshed.');})}>Load saved receipts</button>
  {rows.map((receipt,index)=><section key={receipt.receiptId} className="receipt-saved-row" aria-label={'Receipt '+(index+1)}>
   <p><strong>Receipt {index+1}</strong> · {receipt.status==='available'?'Available':'Upload awaiting validation'} · {receipt.declaredType==='application/pdf'?'PDF':'Image'} · {Math.ceil(receipt.byteSize/1024)} KB</p>
   <div className="receipt-actions">
    {receipt.status==='available'?<>
     <button type="button" className="receipt-view-preview" disabled={busy} aria-label={'View preview for receipt '+(index+1)}
      aria-pressed={preview?.receiptId===receipt.receiptId} onClick={event=>{previewTrigger.current=event.currentTarget;void openPreview(receipt);}}>
      View preview
     </button>
     <button type="button" className="secondary" disabled={busy} aria-label={'Download receipt '+(index+1)} onClick={()=>void download(receipt,'original')}>Download receipt</button>
     <button type="button" className="secondary" disabled={busy} aria-label={'Download preview for receipt '+(index+1)} onClick={()=>void download(receipt,'preview')}>Download preview</button>
    </>:<>
     <button type="button" className="secondary" disabled={writesBlocked} onClick={()=>startResume(receipt)}>Finish saved upload {index+1}</button>
     {file&&<button type="button" className="secondary" disabled={writesBlocked} onClick={()=>startResume(receipt,true)}>Use selected file for receipt {index+1}</button>}
    </>}
   </div>
  </section>)}
  {pending&&<button type="button" className="secondary" disabled={busy||!canRetry} onClick={()=>void attach(pending)}>Retry the same attachment</button>}{resuming&&<><button type="button" className="secondary" disabled={busy||!canRetry} onClick={()=>void resume(resuming)}>Retry saved upload</button>{!resuming.file&&file&&<button type="button" className="secondary" disabled={busy||!canRetry} onClick={resumeWithFile}>Retry with selected original file</button>}</>}{status&&<p role="status">{status}</p>}
   </div>
   {visible&&preview&&<figure ref={previewFigure} className="receipt-preview" aria-label="Receipt preview">
    {/* Preview bytes come from the private receipt download, verified before creating the URL. */}
    <img src={preview.url} alt="Verified receipt preview"/>
    <figcaption><button ref={closeButton} type="button" className="secondary" onClick={()=>{closePreview();previewTrigger.current?.focus();}}>Close preview</button><ReceiptDocumentViewer key={preview.url} url={preview.url} expense={expense}/></figcaption>
   </figure>}
  </div>
 </details>;
}
