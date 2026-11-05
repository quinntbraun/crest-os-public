// Explicit deferred UI clients; no authentication, database or provider claim.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ExpenseEditor} from '../../src/app/expenses/expense-editor';
import {ExpenseReceipts} from '../../src/app/expenses/expense-receipts';
import type {createExpenseClient,ExpenseContext} from '../../src/client/expenses';
import {createReceiptClient} from '../../src/client/expense-receipts';
import type {ExpenseRevision} from '../../src/bookkeeping/expenses/expense-contract';
import type {ReceiptView} from '../../src/bookkeeping/expenses/receipt-contract';
const context:ExpenseContext={businessId:'11111111-1111-1111-1111-111111111111',recoveryEpoch:'22222222-2222-2222-2222-222222222222',writeState:'ready',binding:'A'.repeat(43)};
const row:ExpenseRevision={businessId:context.businessId,expenseId:'33333333-3333-3333-3333-333333333333',operationId:'44444444-4444-4444-4444-444444444444',actorId:'55555555-5555-5555-5555-555555555555',revision:'1',recordedAt:'2026-10-29T02:00:00.000000Z',payload:{paidOn:'2026-10-28',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic deferred expense',vendor:null,paymentMethod:'card',reference:null,notes:null,voided:false,changeReason:null}};
const receipt:ReceiptView={receiptId:'66666666-6666-6666-6666-666666666666',expenseId:row.expenseId,expenseRevision:'1',receiptVersion:'2',status:'available',declaredType:'image/png',byteSize:4,sourceSha256:'a'.repeat(64)};
const readyBlob=new Blob(['synthetic receipt'],{type:'image/png'}),NativeBlob=Blob,nativeUrl=URL.createObjectURL.bind(URL);
let blobCount=0,urlCount=0;
function counters(){const output=document.getElementById('creations');if(output)output.textContent=JSON.stringify({blobCount,urlCount});}
globalThis.Blob=class extends NativeBlob{constructor(parts?:BlobPart[],options?:BlobPropertyBag){super(parts,options);blobCount++;counters();}};
URL.createObjectURL=(value:Blob|MediaSource)=>{urlCount++;counters();return nativeUrl(value);};
let release:(()=>void)|undefined,reads=0;
function delayed<T>(value:T){document.getElementById('pending')!.textContent='Deferred request started';return new Promise<T>(resolve=>{release=()=>{release=undefined;resolve(value);document.getElementById('pending')!.textContent='Deferred request completed';};});}
const client:ReturnType<typeof createExpenseClient>={async lookup(){return {state:'absent'};},async context(){return context;},async history(){return ++reads===1?[row]:delayed([row]);},async save(){throw Error('No save in this fixture');}};
const receiptClient:ReturnType<typeof createReceiptClient>={pending(){return null;},async recover(){return {state:"none"};},async lookup(){return {state:"absent"};},async list(){return [receipt];},async attach(){throw Error();},async resume(){throw Error();},async download(){return delayed({blob:readyBlob,name:`receipt-${receipt.receiptId}.png`});}};
// Real receipt client with explicitly synthetic transport, held before its first
// proof resolves. This proves component lifetime wiring, not authentication.
const phases:string[]=[],nativeFetch=globalThis.fetch.bind(globalThis);let proofCount=0,proofAborted=false;
function transportState(){const output=document.getElementById('transport');if(output)output.textContent=JSON.stringify({phases,aborted:proofAborted});}
const attachingClient=createReceiptClient(async signal=>{signal.addEventListener('abort',()=>{proofAborted=true;transportState();},{once:true});if(++proofCount===1){await delayed(null);if(new URL(location.href).searchParams.has('lost-proof'))throw Error('Synthetic lost proof reply');}return {csrfToken:'B'.repeat(43),expiresAt:Date.now()+60000};},false,sessionStorage);
if(new URL(location.href).searchParams.get('mode')==='attach')globalThis.fetch=async(input,init)=>{
 if(!String(input).startsWith('/api/business/expense-receipts/'))return nativeFetch(input,init);
 const phase=String(input).split('/').at(-1)!;phases.push(phase);transportState();const body=JSON.parse(String(init?.body));if(phase==='reserve')document.getElementById('reserved-original')!.textContent=body.operationId;if(phase==='operation')return new Response(JSON.stringify({state:'absent'}),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});
 const reserved:ReceiptView={...receipt,receiptId:body.receiptId,receiptVersion:'1',byteSize:3,status:'reserved',sourceSha256:null};
 const saved:ReceiptView={...reserved,receiptVersion:'2',status:'available',sourceSha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'};
 if(!['reserve','status'].includes(phase))throw Error('Unexpected synthetic receipt phase');return new Response(JSON.stringify({receipt:phase==='reserve'?reserved:saved}),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});
};
function Harness(){const [shown,setShown]=useState(true),[version,setVersion]=useState('1'),[replacement,setReplacement]=useState(false),mode=new URL(location.href).searchParams.get('mode');return <main>
 <button onClick={()=>setShown(false)}>Leave expense screen</button><button onClick={()=>{setVersion('2');setReplacement(true);}}>Change source scope</button><button onClick={()=>window.dispatchEvent(new PageTransitionEvent('pagehide'))}>Hide expense page</button><button onClick={()=>release?.()}>Complete deferred request</button>
 <output id="pending" aria-label="Deferred state">Idle</output><output id="creations" aria-label="Private download creations">{'{"blobCount":0,"urlCount":0}'}</output>
 <output id="reserved-original" aria-label="Reserved original operation"></output><output id="transport" aria-label="Receipt transport state">{'{"phases":[],"aborted":false}'}</output>
 {shown&&(mode==='receipt'||mode==='attach'?<ExpenseReceipts expense={{...row,revision:version}} context={context} client={mode==='attach'?attachingClient:receiptClient}/>:<ExpenseEditor client={replacement?{...client}:client}/>)}
 </main>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
