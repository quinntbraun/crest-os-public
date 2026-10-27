import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {calculateQuote,quoteDollarsInput,quotePercentInput,quoteMoney,QuotePricingError} from '../../src/commercial/quote-pricing';
import type {QuotePriceLine,QuoteDiscount} from '../../src/commercial/quote-pricing';
const line=(cents:string,patch:Partial<QuotePriceLine>={}):QuotePriceLine=>({id:randomUUID(),grossCents:cents,lineDiscount:null,documentDiscountEligible:true,complimentaryReason:null,...patch});
it('matches BR04 $250/$300 less $25 without losing a cent',()=>{
 const result=calculateQuote([line('25000'),line('30000')],{kind:'fixed',cents:'2500'});
 expect(result.lines.map(l=>l.allocatedDiscountCents)).toEqual(['1136','1364']);expect(result.lines.map(l=>l.finalCents)).toEqual(['23864','28636']);expect(result.totalCents).toBe('52500');
});
it('breaks largest-remainder ties using stable line order',()=>{
 const rows=[line('10001'),line('10001'),line('10001')];expect(calculateQuote(rows,{kind:'fixed',cents:'1000'}).lines.map(l=>l.allocatedDiscountCents)).toEqual(['334','333','333']);
 const reordered=[rows[2]!,rows[0]!,rows[1]!];expect(calculateQuote(reordered,{kind:'fixed',cents:'1000'}).lines[0]!.id).toBe(rows[2]!.id);
});
it('applies the quote percent after the line percent rather than adding rates',()=>expect(calculateQuote([line('10000',{lineDiscount:{kind:'percent',rate:'0.1'}})],{kind:'percent',rate:'0.1'}).totalCents).toBe('8100'));
it('uses round-half-up for exact half cents',()=>{
 const result=calculateQuote([line('1',{lineDiscount:{kind:'percent',rate:'0.5'},complimentaryReason:'Complimentary rounding fixture'})],null);expect(result.lines[0]!.lineDiscountCents).toBe('1');expect(result.totalCents).toBe('0');
});
it('excludes explicit travel lines from document discounts',()=>{
 const result=calculateQuote([line('10000'),line('5000',{documentDiscountEligible:false})],{kind:'percent',rate:'0.25'});expect(result.lines.map(l=>l.finalCents)).toEqual(['7500','5000']);expect(result.totalCents).toBe('12500');
});
it('does not allocate to zero-value eligible lines or divide by zero',()=>{
 const rows=[line('0',{complimentaryReason:'Sample goodwill'}),line('1')];expect(calculateQuote(rows,null).totalCents).toBe('1');
 expect(calculateQuote([line('0',{complimentaryReason:'Sample goodwill'})],{kind:'percent',rate:'1'}).totalCents).toBe('0');
});
it('requires an explicit reason for every complimentary line, including full discounts',()=>{
 expect(()=>calculateQuote([line('0')],null)).toThrow(QuotePricingError);
 expect(()=>calculateQuote([line('100')],{kind:'percent',rate:'1'})).toThrow('complimentary_reason');
 expect(calculateQuote([line('100',{complimentaryReason:'Complimentary test work'})],{kind:'percent',rate:'1'}).totalCents).toBe('0');
});
it.each([
 ['0','0'],['0.01','1'],['125.50','12550'],['92233720368547758.07','9223372036854775807'],[' 250.00 ','25000']
])('parses dollars exactly: %s',(input,cents)=>expect(quoteDollarsInput(input)).toBe(cents));
it.each(['','-1','1.001','1e3','Infinity','$10','10,000','01.00','92233720368547758.08'])('rejects invalid or unrepresentable dollars: %s',input=>expect(()=>quoteDollarsInput(input)).toThrow());
it.each([['0','0.00000000'],['10','0.10000000'],['12.345678','0.12345678'],['100','1.00000000']])('converts percent to an exact stored fraction: %s',(input,rate)=>expect(quotePercentInput(input)).toBe(rate));
it.each(['','-1','100.000001','1.1234567','1e2','Infinity'])('rejects an invalid percentage: %s',input=>expect(()=>quotePercentInput(input)).toThrow());
it('keeps cents beyond JavaScript safe integer range exact',()=>{
 const result=calculateQuote([line('9007199254740993')],{kind:'fixed',cents:'1'});expect(result.totalCents).toBe('9007199254740992');expect(quoteMoney('9223372036854775807')).toBe('$92,233,720,368,547,758.07');
});
it('rejects fixed discounts beyond the eligible subtotal and line amount',()=>{
 expect(()=>calculateQuote([line('100')],{kind:'fixed',cents:'101'})).toThrow('discount_exceeds_amount');
 expect(()=>calculateQuote([line('100',{documentDiscountEligible:false})],{kind:'fixed',cents:'1'})).toThrow('discount_exceeds_amount');
 expect(()=>calculateQuote([line('100',{lineDiscount:{kind:'fixed',cents:'101'}})],null)).toThrow('discount_exceeds_amount');
});
it('rejects duplicate IDs, malformed shapes, precision drift and total overflow',()=>{
 const row=line('100');expect(()=>calculateQuote([row,row],null)).toThrow();
 expect(()=>calculateQuote([{...row,quantity:2} as QuotePriceLine],null)).toThrow();
 expect(()=>calculateQuote([row],{kind:'percent',rate:'0.000000001'})).toThrow();
 expect(()=>calculateQuote([row],{kind:'percent',rate:'1.00000001'})).toThrow();
 expect(()=>calculateQuote([row],{kind:'fixed',cents:'01'})).toThrow();
 expect(()=>calculateQuote([line('9223372036854775807'),line('1')],null)).toThrow('total_overflow');
 expect(()=>calculateQuote([],null)).toThrow('lines');
});
it('conserves cents and never exceeds a line remainder across deterministic varied allocations',()=>{
 for(let count=1;count<=24;count++)for(let seed=0;seed<24;seed++){
  const rows=Array.from({length:count},(_,i)=>line(String(1+(seed*137+i*71)%10001),{documentDiscountEligible:(i+seed)%3!==0,complimentaryReason:'Synthetic allocation fixture'}));
  const eligible=rows.reduce((n,r)=>n+(r.documentDiscountEligible?BigInt(r.grossCents):0n),0n),deduction=eligible*BigInt(seed)/24n,discount:QuoteDiscount={kind:'fixed',cents:deduction.toString()},before=structuredClone(rows),out=calculateQuote(rows,discount);
  expect(out.lines.reduce((n,r)=>n+BigInt(r.allocatedDiscountCents),0n)).toBe(deduction);
  expect(out.lines.every(r=>BigInt(r.allocatedDiscountCents)<=BigInt(r.grossCents)&&BigInt(r.finalCents)>=0n)).toBe(true);
  expect(out.totalCents).toBe((rows.reduce((n,r)=>n+BigInt(r.grossCents),0n)-deduction).toString());expect(rows).toEqual(before);expect(calculateQuote(rows,discount)).toEqual(out);
 }
});
