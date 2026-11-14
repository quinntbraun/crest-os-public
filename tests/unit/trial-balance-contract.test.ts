import {describe,expect,it} from 'vitest';
import {parseFictionalTrialBalance} from '../../src/bookkeeping/trial-balance-contract.ts';

const business='7fab5844-4c30-45e9-9d64-106979f339a8';
const day='2026-11-13';
const dateFields={schemaVersion:1,businessId:business,currency:'USD',observedAt:day+'T07:00:00.000000Z',
  throughOn:day,timeZone:'America/Indiana/Indianapolis'};
const coverage={complete:false,openingBalancesIncluded:false,reconciliationVerified:false,templates:['P01','P02','P03','P12']};
const controls={ledgerBalanced:true,receivablesTie:true,moneyMovementsTie:true};
const debit={accountId:'95ac905e-8ca7-4fd1-96b2-f6465a06b2e5',code:'5000',name:'Fictional supplies',accountType:'expense',
  normalSide:'debit',active:true,debitCents:'10000',creditCents:'0',balanceCents:'10000'};
const credit={accountId:'f2738cef-c17c-459f-9cee-045f02b69443',code:'1000',name:'Fictional checking',accountType:'asset',
  normalSide:'debit',active:true,debitCents:'0',creditCents:'10000',balanceCents:'-10000'};
const totals={debitCents:'10000',creditCents:'10000',debitBalanceCents:'10000',creditBalanceCents:'10000'};
const valid={...dateFields,coverageStart:day,postedEventCount:'1',rows:[credit,debit],coverage,controls,totals};

describe('the private fictional trial balance',()=>{
  it('parses exact debit and credit balances without floating-point arithmetic',()=>{
    const result=parseFictionalTrialBalance(valid,business,day);
    expect(result.rows).toEqual([credit,debit]);
    expect(result.totals).toEqual(totals);
  });
  it('does not present a partial ledger as complete',()=>{
    expect(()=>parseFictionalTrialBalance({...valid,coverage:{...coverage,complete:true}},business,day)).toThrow();
    expect(()=>parseFictionalTrialBalance({...valid,controls:{...controls,moneyMovementsTie:false}},business,day)).toThrow();
  });
  it('rejects changed balance, duplicate rows, stale date and cross-business data',()=>{
    expect(()=>parseFictionalTrialBalance({...valid,rows:[credit,{...debit,balanceCents:'10001'}]},business,day)).toThrow();
    expect(()=>parseFictionalTrialBalance({...valid,rows:[credit,credit]},business,day)).toThrow();
    expect(()=>parseFictionalTrialBalance(valid,business,'2026-11-12')).toThrow();
    expect(()=>parseFictionalTrialBalance(valid,credit.accountId,day)).toThrow();
  });
  it('returns an explicit empty result before the first posted entry',()=>{
    const empty=Object.fromEntries(Object.keys(totals).map(key=>[key,'0']));
    const result=parseFictionalTrialBalance({...valid,coverageStart:null,postedEventCount:'0',rows:[],totals:empty},business,null);
    expect(result.rows).toEqual([]);
    expect(result.postedEventCount).toBe('0');
  });
});
