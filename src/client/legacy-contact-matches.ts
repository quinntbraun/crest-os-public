import {customerLegacyMatches} from './customers';
import {vehicleLegacyMatches} from './vehicles';
import type {Proof} from './authentication';
import {vehicleVinHint} from '../customer/customer-resource-contract';
import {legacyMatchBodyLimit,legacyMatchHintLimit} from '../customer/legacy-contact-match-contract';
import type {LegacyHintKind} from '../customer/legacy-contact-match-contract';

type Row=Readonly<{row:number;phone:string|null;email:string|null;vin:string|null}>;
type RowMatch={kind:LegacyHintKind;count:number};
const hintFor={
 phone:(row:Row)=>row.phone?.replace(/[^0-9]/g,'')||null,
 email:(row:Row)=>row.email?.replace(/^ +| +$/g,'')||null,
 vin:(row:Row)=>vehicleVinHint(row.vin),
};
const hintKinds=['phone','email','vin'] as const;

export function legacyRowsHaveSavedMatchHints(rows:readonly Row[]){
 return rows.some(row=>hintKinds.some(kind=>hintFor[kind](row)!==null));
}

function* hintPages(kind:LegacyHintKind,hints:Iterable<string>){
 const encoder=new TextEncoder(),envelope=encoder.encode(JSON.stringify({kind,hints:[]})).byteLength;
 let size=envelope,page:string[]=[];
 for(const hint of hints){
  const item=encoder.encode(JSON.stringify(hint)).byteLength;
  if(page.length===legacyMatchHintLimit||size+item+Number(page.length>0)>legacyMatchBodyLimit){
   yield page;
   size=envelope;page=[];
  }
  size+=item+Number(page.length>0);
  page.push(hint);
 }
 if(page.length)yield page;
}

export async function findSavedLegacyMatches(rows:readonly Row[],businessId:string,proof:Proof,signal:AbortSignal){
 const byRow=new Map<number,RowMatch[]>();
 for(const kind of hintKinds){
  const rowsForHint=new Map<string,number[]>();
  for(const row of rows){
   const hint=hintFor[kind](row);
   if(hint===null)continue;
   const related=rowsForHint.get(hint)??[];
   related.push(row.row);
   rowsForHint.set(hint,related);
  }
  const find=kind==='vin'?vehicleLegacyMatches:customerLegacyMatches;
  for(const hints of hintPages(kind,rowsForHint.keys())){
   signal.throwIfAborted();
   const counts=await find(businessId,{kind,hints},proof,signal);
   for(const [index,count] of counts.entries()){
    if(count===0)continue;
    for(const row of rowsForHint.get(hints[index]!)!){
     const matches=byRow.get(row)??[];
     matches.push({kind,count});
     byRow.set(row,matches);
    }
   }
  }
 }
 return byRow;
}
