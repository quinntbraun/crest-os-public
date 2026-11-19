export type ProposalPartyRow=Readonly<{id:string;customer_id:string|null;lead_id:string|null}>;
export type ProposalPartyContext=Readonly<{binding:string;context:Readonly<{businessId:string;writeState:'ready'|'paused';recoveryEpoch:string|null}>}>;
export type ProposalParty=Readonly<{kind:'customer'|'lead';label:string}>;
export type ProposalPartyResult=Readonly<{holdId:string;kind:'customer'|'lead';state:'verified';label:string}|{holdId:string;kind:'customer'|'lead';state:'unavailable'}>;
export async function readProposalParties<Proof>(input:Readonly<{businessId:string;binding:string;rows:readonly ProposalPartyRow[]}>,signal:AbortSignal,deps:Readonly<{
 session:(signal:AbortSignal)=>Promise<Proof>;
 context:(proof:Proof,signal:AbortSignal)=>Promise<ProposalPartyContext>;
 party:(businessId:string,row:ProposalPartyRow,proof:Proof,signal:AbortSignal)=>Promise<ProposalParty|null>;
}>):Promise<readonly ProposalPartyResult[]>{
 signal.throwIfAborted();
 if(input.rows.length>10||new Set(input.rows.map(row=>row.id)).size!==input.rows.length||input.rows.some(row=>!row.id||(row.customer_id===null)===(row.lead_id===null)))throw Error('PROPOSAL_IDENTITIES_INPUT');
 if(input.rows.length===0)return Object.freeze([]);
 const rows=input.rows.map(row=>Object.freeze({...row})),businessId=input.businessId,binding=input.binding;
 const proof=await deps.session(signal);signal.throwIfAborted();
 const before=await deps.context(proof,signal);signal.throwIfAborted();
 const pinned={businessId:before.context.businessId,binding:before.binding,writeState:before.context.writeState,recoveryEpoch:before.context.recoveryEpoch};
 if(pinned.businessId!==businessId||pinned.binding!==binding)throw Error('PROPOSAL_IDENTITIES_CONTEXT');
 const results:ProposalPartyResult[]=new Array(rows.length);let next=0;
 const worker=async()=>{while(next<rows.length){signal.throwIfAborted();const index=next++,row=rows[index]!,kind=row.customer_id===null?'lead' as const:'customer' as const;
  try{const value=await deps.party(businessId,row,proof,signal);signal.throwIfAborted();
   results[index]=value&&value.kind===kind&&typeof value.label==='string'&&value.label.trim().length>0?Object.freeze({holdId:row.id,kind,state:'verified',label:value.label}):Object.freeze({holdId:row.id,kind,state:'unavailable'});
  }catch{signal.throwIfAborted();results[index]=Object.freeze({holdId:row.id,kind,state:'unavailable'});}
 }};
 await Promise.all(Array.from({length:Math.min(4,rows.length)},worker));signal.throwIfAborted();
 const latestProof=await deps.session(signal);signal.throwIfAborted();const after=await deps.context(latestProof,signal);signal.throwIfAborted();
 if(after.context.businessId!==pinned.businessId||after.binding!==pinned.binding||after.context.writeState!==pinned.writeState||after.context.recoveryEpoch!==pinned.recoveryEpoch)throw Error('PROPOSAL_IDENTITIES_CONTEXT');
 return Object.freeze(results);
}
