// Explicit deferred UI clients; no authentication, database or provider claim.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ExpenseEditor} from '../../src/app/expenses/expense-editor';
import {ExpenseReceipts} from '../../src/app/expenses/expense-receipts';
import type {createExpenseClient,ExpenseContext} from '../../src/client/expenses';
import type {createReceiptClient} from '../../src/client/expense-receipts';
import type {ExpenseRevision} from '../../src/bookkeeping/expenses/expense-contract';
import type {ReceiptView} from '../../src/bookkeeping/expenses/receipt-contract';
const context:ExpenseContext={businessId:'11111111-1111-1111-1111-111111111111',recoveryEpoch:'22222222-2222-2222-2222-222222222222',writeState:'ready',binding:'explicit-lifecycle-seam'};
const row:ExpenseRevision={businessId:context.businessId,expenseId:'33333333-3333-3333-3333-333333333333',operationId:'44444444-4444-4444-4444-444444444444',actorId:'55555555-5555-5555-5555-555555555555',revision:'1',recordedAt:'2026-10-29T02:00:00.000000Z',payload:{paidOn:'2026-10-28',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic deferred expense',vendor:null,paymentMethod:'card',reference:null,notes:null,voided:false,changeReason:null}};
const receipt:ReceiptView={receiptId:'66666666-6666-6666-6666-666666666666',expenseId:row.expenseId,expenseRevision:'1',receiptVersion:'2',status:'available',declaredType:'image/png',byteSize:4,sourceSha256:'a'.repeat(64)};
const readyBlob=new Blob(['synthetic receipt'],{type:'image/png'}),NativeBlob=Blob,nativeUrl=URL.createObjectURL.bind(URL);
let blobCount=0,urlCount=0;
function counters(){const output=document.getElementById('creations');if(output)output.textContent=JSON.stringify({blobCount,urlCount});}
globalThis.Blob=class extends NativeBlob{constructor(parts?:BlobPart[],options?:BlobPropertyBag){super(parts,options);blobCount++;counters();}};
URL.createObjectURL=(value:Blob|MediaSource)=>{urlCount++;counters();return nativeUrl(value);};
let release:(()=>void)|undefined,reads=0;
function delayed<T>(value:T){document.getElementById('pending')!.textContent='Deferred request started';return new Promise<T>(resolve=>{release=()=>{release=undefined;resolve(value);document.getElementById('pending')!.textContent='Deferred request completed';};});}
const client:ReturnType<typeof createExpenseClient>={async context(){return context;},async history(){return ++reads===1?[row]:delayed([row]);},async save(){throw Error('No save in this fixture');}};
const receiptClient:ReturnType<typeof createReceiptClient>={async list(){return [receipt];},async attach(){throw Error();},async resume(){throw Error();},async download(){return delayed({blob:readyBlob,name:`receipt-${receipt.receiptId}.png`});}};
function Harness(){const [shown,setShown]=useState(true),[version,setVersion]=useState('1'),[replacement,setReplacement]=useState(false),mode=new URL(location.href).searchParams.get('mode');return <main>
 <button onClick={()=>setShown(false)}>Leave expense screen</button><button onClick={()=>{setVersion('2');setReplacement(true);}}>Change source scope</button><button onClick={()=>release?.()}>Complete deferred request</button>
 <output id="pending" aria-label="Deferred state">Idle</output><output id="creations" aria-label="Private download creations">{'{"blobCount":0,"urlCount":0}'}</output>
 {shown&&(mode==='receipt'?<ExpenseReceipts expense={{...row,revision:version}} context={context} client={receiptClient}/>:<ExpenseEditor client={replacement?{...client}:client}/>)}
 </main>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
