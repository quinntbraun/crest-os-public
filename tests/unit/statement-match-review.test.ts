import {describe,expect,it} from 'vitest';
import {reviewStatementMatches} from '../../src/bookkeeping/statement-match-review.ts';

const id=(n:number)=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');
const account=id(1);
const statement={accountId:account,startsOn:'2026-11-01',endsOn:'2026-11-30',rows:[
 {id:id(2),statementOn:'2026-11-10',signedCents:'120'},
 {id:id(3),statementOn:'2026-11-11',signedCents:'80'},
 {id:id(4),statementOn:'2026-11-12',signedCents:'-50'},
]};
const movement=(n:number,signedCents:string,previouslyMatchedCents='0')=>({
 id:id(n),accountId:account,effectiveOn:'2026-10-31',signedCents,previouslyMatchedCents,
});
const sources=[movement(5,'150','20'),movement(6,'70'),movement(7,'-75','-25')];
const match=(row:number,source:number,signedCents:string)=>({statementRowId:id(row),movementId:id(source),signedCents});
const proposals=[match(2,5,'100'),match(2,6,'20'),match(3,5,'30'),match(3,6,'50'),match(4,7,'-50')];
const review=(input:readonly unknown[],ledger=sources)=>reviewStatementMatches(statement,input,key=>ledger.find(row=>row.id===key));

describe('explicit statement match review',()=>{
 it('resolves split positive and negative amounts without reusing earlier clearances',()=>{
  expect(review(proposals)).toEqual({state:'fully_allocated',outstanding:[]});
  expect(review(proposals.slice(0,2))).toEqual({state:'unmatched_rows',outstanding:[
   {rowId:id(3),remainingCents:'80'},{rowId:id(4),remainingCents:'-50'},
  ]});
 });
 it.each([
  [match(2,5,'119'),match(2,6,'2')],
  [match(2,5,'100'),match(3,5,'31')],
  [match(2,5,'1'),match(2,5,'1')],
  [match(4,7,'-51')],
  [match(4,5,'-50')],
  [match(2,7,'50')],
  [match(2,5,'0')],
  [match(2,99,'10')],
 ])('rejects duplicate, excessive, wrong direction and unsupported allocations %j',(...matches)=>{
  expect(()=>review(matches)).toThrow('STATEMENT_MATCH_REVIEW_REQUIRED');
 });
 it('refuses a different account or a movement dated after its statement row',()=>{
  expect(()=>review([match(2,5,'20')],[{...sources[0]!,accountId:id(9)}])).toThrow('STATEMENT_MATCH_REVIEW_REQUIRED');
  expect(()=>review([match(2,5,'20')],[{...sources[0]!,effectiveOn:'2026-11-11'}])).toThrow('STATEMENT_MATCH_REVIEW_REQUIRED');
 });
});
