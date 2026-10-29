import {expenseCheck as check,expenseHistory,expenseExact as exact} from './expense-contract.ts';
import {parseReceiptReservation,parseReceiptRecord} from './receipt-contract.ts';
import type {ReceiptRecord} from './receipt-contract.ts';
import type {RecoveryObject} from '../../tooling/object-recovery.ts';
type Sources=Readonly<{businessId:string;expenseHistory:unknown;receiptHistory:unknown}>;
// Consistency of supplied sources only. A formatter cannot prove a held database
// snapshot, source completeness, authorization or independent backup custody.
export function expenseReceiptSources(input:Sources){
 check(exact(input,['businessId','expenseHistory','receiptHistory']));const expenses=expenseHistory(input.expenseHistory,input.businessId);
 check(Array.isArray(input.receiptHistory)&&input.receiptHistory.length<=2000);
 const versions=new Set(expenses.rows.map(r=>r.expenseId+':'+r.revision)),operations=new Set(expenses.rows.map(r=>r.operationId));
 const rows=input.receiptHistory.map(value=>{check(exact(value,['receiptVersion','operationId','actorId','recordedAt','reservation','candidate']));const r=parseReceiptReservation(value.reservation);return parseReceiptRecord(value,input.businessId,r.receiptId);}).sort((a,b)=>a.reservation.receiptId.localeCompare(b.reservation.receiptId)||Number(a.receiptVersion)-Number(b.receiptVersion));
 const current=new Map<string,ReceiptRecord>();
 for(const row of rows){const r=row.reservation,prior=current.get(r.receiptId);check(versions.has(r.expenseId+':'+r.expenseRevision)&&!operations.has(row.operationId)&&Number(row.receiptVersion)===Number(prior?.receiptVersion??'0')+1&&(!prior||Object.entries(r).every(([k,v])=>prior.reservation[k as keyof typeof r]===v)));operations.add(row.operationId);current.set(r.receiptId,row);}
 const columns=['expense_id','expense_revision','receipt_id','receipt_version','is_current','status','declared_type','byte_size','source_sha256','original_file','preview_file','validation_version','recorded_at','actor_id','operation_id'];
 const csvRows=[columns];
 for(const row of rows){const r=row.reservation,c=row.candidate,ext=r.declaredType==='application/pdf'?'pdf':r.declaredType==='image/png'?'png':r.declaredType==='image/heic'?'heic':'jpg';csvRows.push([r.expenseId,r.expenseRevision,r.receiptId,row.receiptVersion,String(current.get(r.receiptId)===row),c?'available':'reserved',r.declaredType,String(r.byteSize),c?.source.sha256??'',c?`receipt-${r.receiptId}.${ext}`:'',c?`receipt-${r.receiptId}-preview.jpg`:'',c?.validationVersion??'',row.recordedAt,row.actorId,row.operationId]);}
 const csv=csvRows.map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
 const latest=Object.freeze([...current.values()]);
 const metadata=JSON.stringify({profile:'crest.expense-receipts.v1',businessId:input.businessId,receiptCount:latest.length,retainedRevisionCount:rows.length,pendingReceiptIds:latest.filter(r=>!r.candidate).map(r=>r.reservation.receiptId),links:'File names match the separate private original/preview downloads. Keep those files alongside this CSV. Formatting does not establish that the files were downloaded or backed up. Import IDs, revisions and hashes as text.',referenceClosure:'Every supplied receipt refers to a supplied retained expense revision. Voided expenses and earlier receipt states are retained.',snapshotProven:false,sourceCompletenessProven:false,completeCrestExport:false,completeBackup:false},null,2)+'\n';
 return Object.freeze({csv,metadata,rows:Object.freeze(rows),latest});
}
export function expenseReceiptRecoveryInventory(input:Sources):readonly RecoveryObject[]{
 const source=expenseReceiptSources(input);check(source.latest.every(r=>r.candidate!==null));const inventory:RecoveryObject[]=[];
 // Include receipts of voided and corrected expenses. Do not filter to current
 // accounting totals or silently discard a pending/uncertain original.
 for(const row of source.latest){const c=row.candidate!;inventory.push(Object.freeze({...c.original,retention:'original' as const}),Object.freeze({key:c.preview.key,byteSize:c.preview.byteSize,sha256:c.preview.sha256,retention:'derivative' as const}));}
 check(inventory.length<=1000&&new Set(inventory.map(o=>o.key)).size===inventory.length);return Object.freeze(inventory);
}
