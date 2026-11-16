import {describe,expect,it} from 'vitest';
import {assessDedicatedStatementValues} from '../../src/bookkeeping/statement-reconciliation.ts';

const id=(value:number)=>'a0000000-0000-4000-8000-'+String(value).padStart(12,'0');
const account={accountId:id(1),kind:'bank',ownershipScope:'dedicated_business',active:true} as const;
const balance={accountId:account.accountId,throughOn:'2026-11-30',signedCents:'1150'};
const statement={
  id:id(2),accountId:account.accountId,startsOn:'2026-11-01',endsOn:balance.throughOn,
  openingCents:'1000',closingCents:'1050',fileSha256:'a'.repeat(64),
  providerDateConvention:'Provider local settlement date',completenessEvidence:'Fictional complete monthly statement reviewed',
  rows:[{id:id(3),statementOn:'2026-11-01',signedCents:'200'},{id:id(4),statementOn:'2026-11-30',signedCents:'-150'}],
};
const timing=[
  {sourceId:id(5),expectedClearOn:'2026-12-01',evidence:'Fictional receipt identified on the later statement'},
  {sourceId:id(6),expectedClearOn:'2026-11-29',evidence:'Fictional issued uncleared payment held for review'},
];
const sources=[
  {id:id(5),accountId:account.accountId,kind:'money_movement' as const,effectiveOn:'2026-11-28',signedCents:'300',
    clearances:[{id:id(7),clearedOn:'2026-11-30',signedCents:'50'},{id:id(8),clearedOn:'2026-12-01',signedCents:'250'}]},
  {id:id(6),accountId:account.accountId,kind:'approved_opening' as const,effectiveOn:'2026-10-31',signedCents:'-200',
    clearances:[{id:id(9),clearedOn:'2026-11-27',signedCents:'-50'}]},
];
const read=(sourceId:string)=>sources.find(source=>source.id===sourceId);
const check=(change:Partial<typeof statement>={},items:unknown=timing)=>
  assessDedicatedStatementValues(account,balance,{...statement,...change},items,read);
const refuses=(fn:()=>unknown)=>expect(fn).toThrow('STATEMENT_RECONCILIATION_REVIEW_REQUIRED');

describe('dedicated statement arithmetic',()=>{
  it('balances signed rows and actual partial clearance through the statement end',()=>{
    expect(check()).toEqual({state:'arithmetic_balanced',statementRowTotalCents:'50',statementDifferenceCents:'0',
      outstandingTimingCents:'100',ledgerDifferenceCents:'0'});
    expect(check({},[...timing].reverse())).toEqual(check());
  });

  it('permits a genuinely empty reviewed statement and negative account balances',()=>{
    expect(assessDedicatedStatementValues({...account,kind:'wallet'},{...balance,signedCents:'-500'},
      {...statement,openingCents:'-500',closingCents:'-500',rows:[]},[],()=>undefined).state).toBe('arithmetic_balanced');
  });

  it('keeps missing statement facts and omitted timing sources visible as distinct residuals',()=>{
    expect(check({rows:statement.rows.slice(0,1)},[])).toEqual({
      state:'needs_review',statementRowTotalCents:'200',statementDifferenceCents:'-150',
      outstandingTimingCents:'0',ledgerDifferenceCents:'100',
    });
  });

  it('keeps long integer arithmetic exact even when the difference exceeds the stored cent bound',()=>{
    const result=assessDedicatedStatementValues(account,{...balance,signedCents:'9223372036854775807'},
      {...statement,openingCents:'-9223372036854775808',closingCents:'9223372036854775807',rows:[]},[],read);
    expect(result.statementDifferenceCents).toBe('18446744073709551615');
    expect(result.state).toBe('needs_review');
  });

  it.each([
    {fileSha256:'invalid'},
    {providerDateConvention:' '},
    {completenessEvidence:''},
    {startsOn:'2026-11-31'},
    {startsOn:'2026-12-01'},
    {openingCents:'-0'},
    {closingCents:'9223372036854775808'},
    {rows:[statement.rows[0]!,statement.rows[0]!]},
    {rows:[{...statement.rows[0]!,statementOn:'2026-10-31'}]},
    {rows:[{...statement.rows[0]!,statementOn:'2026-12-01'}]},
    {rows:[{...statement.rows[0]!,signedCents:'0'}]},
  ])('refuses invalid, duplicate, or out-of-window statement evidence %j',change=>refuses(()=>check(change)));

  it('refuses a different account, a mixed account or a stale balance date',()=>{
    refuses(()=>check({accountId:id(99)}));
    refuses(()=>assessDedicatedStatementValues({...account,ownershipScope:'mixed_personal'},balance,statement,timing,read));
    refuses(()=>assessDedicatedStatementValues(account,{...balance,throughOn:'2026-11-29'},statement,timing,read));
  });

  it('requires unique, individually evidenced timing sources and forbids a typed-in balance plug',()=>{
    const first=timing[0]!;
    refuses(()=>check({},[first,first]));
    refuses(()=>check({},[{...first,evidence:' '}]));
    refuses(()=>check({},[{...first,sourceId:id(99)}]));
    refuses(()=>check({},[{...first,signedCents:'100'}]));
    refuses(()=>check({},[{...first,clearances:[]}]));
    refuses(()=>check({},[{...first,expectedClearOn:'2026-11-27'}]));
  });

  it.each([
    {accountId:id(99)},
    {effectiveOn:'2026-12-01'},
    {clearances:[{id:id(7),clearedOn:'2026-11-27',signedCents:'50'}]},
    {clearances:[{id:id(7),clearedOn:'2026-11-30',signedCents:'-50'}]},
    {clearances:[{id:id(7),clearedOn:'2026-12-01',signedCents:'301'}]},
    {clearances:[sources[0]!.clearances[0]!,sources[0]!.clearances[0]!]},
  ])('refuses unsupported timing source or excess clearance %j',change=>{
    const first=sources[0]!;
    refuses(()=>assessDedicatedStatementValues(account,balance,statement,timing,
      sourceId=>sourceId===first.id?{...first,...change}:read(sourceId)));
  });
});
