import {openingControls} from './opening-worksheet-contract.ts';
import type {OpeningReceipt} from './opening-worksheet-contract.ts';

type ReceivablesEvidence=Readonly<{businessId:string;worksheetRevisionId:string;revision:string;
 evidence:Readonly<{cutoverOn:string;totals:Readonly<{remainingCents:string}>}>}>;
type Worksheet=Pick<OpeningReceipt,'businessId'|'worksheetRevisionId'|'cutoverOn'|'controls'> & {
 banks:readonly Pick<OpeningReceipt['banks'][number],'bookCents'|'label'|'accountCode'>[];
};
type PreviewLine={accountCode:string;label:string;debitCents:string;creditCents:string};

export function previewOpeningPosting(worksheet:Worksheet,receivables:ReceivablesEvidence|null){
 const blockers:string[]=[];
 const warnings:string[]=[];
 const lines:PreviewLine[]=[];
 let net=0n;
 function add(accountCode:string,label:string,cents:bigint){
  if(cents===0n)return;
  lines.push({accountCode,label,debitCents:String(cents>0n?cents:0n),creditCents:String(cents<0n?-cents:0n)});
  net+=cents;
 }
 for(const bank of worksheet.banks){
  if(bank.bookCents===null){
   blockers.push(bank.label+' needs a verified book balance.');
   continue;
  }
  const book=BigInt(bank.bookCents);
  if(book<0n){
   warnings.push(bank.label+' has a negative balance. It remains on this account; review any borrowing agreement separately.');
  }
  add(bank.accountCode,bank.label,book);
 }
 for(const [key,label] of Object.entries(openingControls) as [keyof typeof openingControls,string][]){
  if(worksheet.controls[key].state==='unknown')blockers.push('Verify '+label.toLowerCase()+'.');
 }
 if(receivables){
  if(receivables.businessId!==worksheet.businessId||receivables.worksheetRevisionId!==worksheet.worksheetRevisionId
   ||receivables.evidence.cutoverOn!==worksheet.cutoverOn)throw Error('OPENING_POSTING_EVIDENCE_MISMATCH');
  const remaining=BigInt(receivables.evidence.totals.remainingCents);
  if(remaining>0n){
   if(worksheet.controls.receivables.state==='unknown'){
    add('1100','Opening customer balances owed',remaining);
   }else blockers.push('The saved receivables schedule conflicts with the worksheet’s receivables classification.');
  }
 }
 add('3000','Provisional opening equity',-net);
 const totalDebit=lines.reduce((total,line)=>total+BigInt(line.debitCents),0n);
 return {lines,blockers,warnings,totalDebitCents:String(totalDebit),totalCreditCents:String(totalDebit)} as const;
}
