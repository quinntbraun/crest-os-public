import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract';
const maximum=9223372036854775807n,scale=100000000n;
export type QuoteDiscount=Readonly<{kind:'fixed';cents:string}|{kind:'percent';rate:string}>;
export type QuotePriceLine=Readonly<{id:string;grossCents:string;lineDiscount:QuoteDiscount|null;documentDiscountEligible:boolean;complimentaryReason:string|null}>;
export class QuotePricingError extends Error{
 readonly code:string;readonly lineId:string|null;
 constructor(code:string,lineId:string|null=null){super(code);this.name='QuotePricingError';this.code=code;this.lineId=lineId;}
}
function fail(code:string,id:string|null=null):never{throw new QuotePricingError(code,id);}
function cents(value:unknown):bigint{
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(value))return fail('amount');
 const result=BigInt(value);if(result>maximum)return fail('amount');return result;
}
function rate(value:unknown):bigint{
 if(typeof value!=='string'||! /^(0|1)(?:\.[0-9]{1,8})?$/.test(value))return fail('percentage');
 const [whole,fraction='']=value.split('.'),result=BigInt(whole!)*scale+BigInt(fraction.padEnd(8,'0'));
 if(result>scale)return fail('percentage');return result;
}
function discount(value:unknown,base:bigint){
 if(value===null)return 0n;
 let result:bigint;
 if(exact(value,['kind','cents'])&&value.kind==='fixed')result=cents(value.cents);
 else if(exact(value,['kind','rate'])&&value.kind==='percent')result=(base*rate(value.rate)+scale/2n)/scale;
 else return fail('discount');
 if(result>base)return fail('discount_exceeds_amount');return result;
}
function reason(value:unknown):value is string|null{
 return value===null||typeof value==='string'&&value.trim().length>0&&[...value].length<=1000&&[...value].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||n===9||n===10||n===13);});
}
/** BR04: gross is the owner's all-in amount AFTER adjustments/embedded travel.
 * Quantity is one. This calculation neither issues an offer nor posts tax/money.
 * Array order is the stable commercial line order used for remainder ties. */
export function calculateQuote(lines:readonly QuotePriceLine[],documentDiscount:QuoteDiscount|null){
 if(!Array.isArray(lines)||lines.length===0||lines.length>1000)return fail('lines');
 const ids=new Set<string>();
 const rows=lines.map(line=>{
  if(!exact(line,['id','grossCents','lineDiscount','documentDiscountEligible','complimentaryReason'])||!customerUuid(line.id)||ids.has(line.id)||typeof line.documentDiscountEligible!=='boolean'||!reason(line.complimentaryReason))return fail('line');
  ids.add(line.id);const gross=cents(line.grossCents),lineDiscount=discount(line.lineDiscount,gross);
  return{id:line.id,documentDiscountEligible:line.documentDiscountEligible,complimentaryReason:line.complimentaryReason,gross,lineDiscountCents:lineDiscount,remaining:gross-lineDiscount,allocated:0n};
 });
 const gross=rows.reduce((n,r)=>n+r.gross,0n),lineDiscount=rows.reduce((n,r)=>n+r.lineDiscountCents,0n);
 if(gross>maximum)return fail('total_overflow');
 const eligible=rows.reduce((n,r)=>n+(r.documentDiscountEligible?r.remaining:0n),0n),wholeDiscount=discount(documentDiscount,eligible);
 if(eligible>0n&&wholeDiscount>0n){
  const shares=rows.filter(row=>row.documentDiscountEligible&&row.remaining>0n).map(row=>({row,remainder:wholeDiscount*row.remaining%eligible}));
  for(const share of shares)share.row.allocated=wholeDiscount*share.row.remaining/eligible;
  let left=wholeDiscount-shares.reduce((n,s)=>n+s.row.allocated,0n);
  // Stable sort retains original line order when remainders are equal.
  shares.sort((a,b)=>a.remainder===b.remainder?0:a.remainder>b.remainder?-1:1);
  for(const share of shares){if(left===0n)break;share.row.allocated++;left--;}
  if(left!==0n)return fail('allocation');
 }
 const output=rows.map(row=>{
  const final=row.remaining-row.allocated;
  if(final===0n&&row.complimentaryReason===null)return fail('complimentary_reason',row.id);
  if(final<0n||row.allocated>row.remaining)return fail('allocation');
  return Object.freeze({id:row.id,grossCents:row.gross.toString(),lineDiscountCents:row.lineDiscountCents.toString(),allocatedDiscountCents:row.allocated.toString(),finalCents:final.toString(),documentDiscountEligible:row.documentDiscountEligible,complimentaryReason:row.complimentaryReason});
 });
 const total=output.reduce((n,row)=>n+BigInt(row.finalCents),0n);
 if(total!==gross-lineDiscount-wholeDiscount)return fail('allocation');
 return Object.freeze({currency:'USD' as const,grossCents:gross.toString(),lineDiscountCents:lineDiscount.toString(),documentDiscountCents:wholeDiscount.toString(),totalCents:total.toString(),lines:Object.freeze(output)});
}
export function quoteDollarsInput(value:string):string{
 const match=/^(0|[1-9][0-9]{0,16})(?:\.([0-9]{1,2}))?$/.exec(value.trim());
 if(!match)return fail('amount');const result=BigInt(match[1]!)*100n+BigInt((match[2]??'').padEnd(2,'0'));return cents(result.toString()).toString();
}
export function quotePercentInput(value:string):string{
 const match=/^(0|[1-9][0-9]{0,2})(?:\.([0-9]{1,6}))?$/.exec(value.trim());if(!match)return fail('percentage');
 const units=BigInt(match[1]!)*1000000n+BigInt((match[2]??'').padEnd(6,'0'));if(units>scale)return fail('percentage');
 return units===scale?'1.00000000':'0.'+units.toString().padStart(8,'0');
}
export function quoteMoney(value:string):string{const amount=cents(value);return '$'+(amount/100n).toLocaleString('en-US')+'.'+(amount%100n).toString().padStart(2,'0');}
