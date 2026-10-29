import type {Proof} from './authentication';
import {expenseCheck as check,expenseId,expenseExact,parseExpenseSave,parseExpenseRevision,expenseRevision,expenseHistory} from '../bookkeeping/expenses/expense-contract';
import type {ExpenseSave,ExpenseRevision} from '../bookkeeping/expenses/expense-contract';
export type ExpenseContext=Readonly<{businessId:string;recoveryEpoch:string|null;writeState:'ready'|'paused';binding:string}>;
export function createExpenseClient(getProof:()=>Promise<Proof>){
 async function post(route:'context'|'history'|'save',body:object,binding?:string){
  const proof=await getProof();check(typeof proof.csrfToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(proof.csrfToken)&&proof.expiresAt>Date.now());const signal=AbortSignal.timeout(40000),response=await fetch('/api/business/expenses/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken,...(binding?{'x-crest-edit-binding':binding}:{})},body:JSON.stringify(body),signal});
  check(response.headers.get('cache-control')?.includes('no-store')&&/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??''));const reader=response.body?.getReader();check(reader);const parts:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;check(size<=8388608);parts.push(part.value);}}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text),nodes=[value];let fields=0,visited=0;while(nodes.length){check(++visited<=50000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length===fields);return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding')};
 }
 return Object.freeze({
  async context():Promise<ExpenseContext>{const r=await post('context',{}),v=r.value;check(r.status===200&&expenseExact(v,['businessId','recoveryEpoch','writeState'])&&expenseId(v.businessId)&&((v.writeState==='ready'&&expenseId(v.recoveryEpoch))||(v.writeState==='paused'&&v.recoveryEpoch===null))&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{43}$/.test(r.binding));return Object.freeze({...v,binding:r.binding}) as ExpenseContext;},
  async history(context:ExpenseContext):Promise<readonly ExpenseRevision[]>{const r=await post('history',{afterExpenseId:null,afterRevision:'0'},context.binding);check(r.status===200&&expenseExact(r.value,['rows'])&&Array.isArray(r.value.rows)&&r.value.rows.length<=1000);return expenseHistory(r.value.rows,context.businessId).rows;},
  async save(context:ExpenseContext,input:ExpenseSave){const r=parseExpenseSave(input);check(r.businessId===context.businessId&&r.recoveryEpoch===context.recoveryEpoch&&context.writeState==='ready');const {businessId:_,payload,...rest}=r;void _;const reply=await post('save',{...rest,...payload},context.binding),v=reply.value;
   if(reply.status===409&&expenseExact(v,['state','reason'])&&v.state==='conflict'&&v.reason==='operation')return Object.freeze({state:'conflict' as const});
   if(reply.status===409&&expenseExact(v,['state','reason','currentRevision'])&&v.state==='conflict'&&v.reason==='version'&&expenseRevision(v.currentRevision,true))return Object.freeze({state:'conflict' as const});
   check(reply.status===200&&expenseExact(v,['state','expense'])&&v.state==='committed');const expense=parseExpenseRevision(v.expense,r.businessId);check(expense.expenseId===r.expenseId&&expense.operationId===r.operationId&&BigInt(expense.revision)===BigInt(r.expectedRevision)+1n);return Object.freeze({state:'committed' as const,expense});
  }
 });
}
