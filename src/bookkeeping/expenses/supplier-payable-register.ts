import {createHash} from 'node:crypto';
import {expenseCheck as check} from './expense-contract.ts';
import {parseSupplierPayableRegister,supplierPayableRegisterColumns as columns} from './supplier-payable-register-contract.ts';

const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';

export function formatSupplierPayableRegister(pages:readonly unknown[],businessId:string,throughOn:string){
 check(pages.length>0);
 const summary=parseSupplierPayableRegister(pages[0],businessId,throughOn,null);
 check(pages.length===Math.max(1,Math.ceil(summary.rowCount/50)));
 const lines=[columns.map(quote).join(',')];
 const vendorEscapes:string[]=[];
 let cursor:string|null=null,outstanding=0n,openCount=0,rowCount=0;
 for(const [index,value] of pages.entries()){
  const page:ReturnType<typeof parseSupplierPayableRegister>=index===0?summary:
   parseSupplierPayableRegister(value,businessId,throughOn,cursor);
  check(page.sourceSha256===summary.sourceSha256&&page.rowCount===summary.rowCount&&page.openCount===summary.openCount
   &&page.outstandingCents===summary.outstandingCents&&page.ledgerPayableCents===summary.ledgerPayableCents
   &&page.hasMore===(index<pages.length-1));
  for(const row of page.rows){
   const escaped=row.vendor.startsWith("'")||['=','+','-','@'].includes(row.vendor[0]!);
   if(escaped)vendorEscapes.push(row.payableId);
   const record={...row,vendor:escaped?"'"+row.vendor:row.vendor};
   lines.push(columns.map(column=>quote(String(record[column]))).join(','));
   outstanding+=BigInt(row.remainingCents);
   openCount+=Number(row.remainingCents!=='0');
   rowCount++;
   cursor=row.payableId;
  }
 }
 check(rowCount===summary.rowCount&&openCount===summary.openCount&&outstanding.toString()===summary.outstandingCents);
 const csv=lines.join('\r\n')+'\r\n';
 const metadata=JSON.stringify({schemaVersion:1,scope:summary.scope,businessId,throughOn,sourceSha256:summary.sourceSha256,
  columns,rowCount,openCount,outstandingCents:summary.outstandingCents,ledgerPayableCents:summary.ledgerPayableCents,
  ledgerAgrees:summary.ledgerAgrees,csvSha256:createHash('sha256').update(csv).digest('hex'),vendorEscapes},null,2)+'\n';
 return {csv,metadata};
}
