'use client';
import {useId,useLayoutEffect,useRef,useState} from 'react';
import type {ExpenseRevision} from '../../bookkeeping/expenses/expense-contract';
import {expenseDollars} from '../../bookkeeping/expenses/expense-contract';
const levels=[50,75,100,125,150,200,300] as const;
const paidDate=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});

export function ReceiptDocumentViewer({url,expense}:{url:string;expense:ExpenseRevision}){
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null),viewport=useRef<HTMLDivElement>(null);
 const title=useId(),[open,setOpen]=useState(false),[zoom,setZoom]=useState<number>(100),[failed,setFailed]=useState(false),[message,setMessage]=useState('');
 const previousZoom=useRef(100),reset=useRef(true);
 useLayoutEffect(()=>{
  const canvas=viewport.current;if(!open||!canvas)return;
  if(reset.current){canvas.scrollTo(0,0);reset.current=false;}
  else{const ratio=zoom/previousZoom.current;canvas.scrollLeft=(canvas.scrollLeft+canvas.clientWidth/2)*ratio-canvas.clientWidth/2;canvas.scrollTop=(canvas.scrollTop+canvas.clientHeight/2)*ratio-canvas.clientHeight/2;}
  previousZoom.current=zoom;
 },[open,zoom]);
 function show(){
  const element=dialog.current;if(!element||element.open||document.visibilityState==='hidden'||document.querySelector('dialog[open]'))return;
  if(typeof element.showModal!=='function'){setMessage('The larger viewer is unavailable here. Use the inline preview or download the receipt.');return;}
  reset.current=true;previousZoom.current=100;setZoom(100);setFailed(false);setMessage('');setOpen(true);
  try{element.showModal();close.current?.focus();}catch{setOpen(false);setMessage('The larger viewer could not open. Use the inline preview or try again.');}
 }
 function fit(){reset.current=true;if(zoom===100){viewport.current?.scrollTo(0,0);reset.current=false;}else setZoom(100);}
 function step(direction:-1|1){const index=levels.indexOf(zoom as typeof levels[number]);const next=levels[index+direction];if(next!==undefined)setZoom(next);}
 return <>
  <button ref={opener} type="button" className="secondary" aria-haspopup="dialog" onClick={show}>Enlarge receipt preview</button>
  {message&&<p role="status">{message}</p>}
  <dialog ref={dialog} className="receipt-document-viewer" aria-labelledby={title} onClose={()=>{setOpen(false);if(document.visibilityState!=='hidden'&&opener.current?.isConnected)opener.current.focus({preventScroll:true});}}>
   <header className="receipt-viewer-heading"><div><h2 id={title}>Receipt preview</h2><p className="receipt-viewer-description" title={expense.payload.description}>{expense.payload.description}</p><p className="receipt-viewer-facts"><strong>Recorded expense: ${expenseDollars(expense.payload.amountCents)} USD</strong><span>Paid on <time dateTime={expense.payload.paidOn}>{paidDate.format(new Date(expense.payload.paidOn+'T00:00:00Z'))}</time></span></p></div><button ref={close} type="button" className="secondary" onClick={()=>dialog.current?.close()}>Close viewer</button></header>
   <div className="receipt-viewer-toolbar" role="group" aria-label="Preview size"><button type="button" className="secondary" aria-label="Zoom out" disabled={failed||zoom===levels[0]} onClick={()=>step(-1)}>−</button><output aria-label="Preview zoom" aria-live="polite">{zoom}%{zoom===100?' · Fit to width':''}</output><button type="button" className="secondary" aria-label="Zoom in" disabled={failed||zoom===levels.at(-1)} onClick={()=>step(1)}>+</button><button type="button" className="secondary" disabled={failed} onClick={fit}>Fit to width</button></div>
   <div className="receipt-viewer-viewport" ref={viewport} tabIndex={0} role="region" aria-label="Receipt image. Scroll to inspect the preview">
    {open&&(failed?<p role="status" aria-label="Receipt image display status">The preview image could not be displayed. Close the viewer and load the preview again.</p>:<div className="receipt-viewer-canvas" data-zoom={zoom}><img src={url} alt="Enlarged verified receipt preview" onError={()=>setFailed(true)}/></div>)}
   </div>
   <p className="receipt-viewer-caption">Preview image. Download the original receipt to review the full file.</p>
  </dialog>
 </>;
}
