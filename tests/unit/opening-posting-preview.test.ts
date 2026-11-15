import {expect,it} from 'vitest';
import {previewOpeningPosting} from '../../src/bookkeeping/opening-posting-preview.ts';
import type {OpeningControl} from '../../src/bookkeeping/opening-worksheet-contract.ts';

const unknown:OpeningControl={state:'unknown',evidence:null,note:'Fictional balance under review'};
const zero:OpeningControl={state:'verified_zero',evidence:{reference:'Fictional evidence',sha256:'a'.repeat(64)},note:'Zero verified'};
const opening={
 businessId:'business',worksheetRevisionId:'worksheet',cutoverOn:'2026-01-01',
 banks:[{label:'Checking',accountCode:'1000',bookCents:'17005'}],
 controls:{receivables:unknown,customerFunds:unknown,supplierPayables:unknown,taxLiabilities:unknown,otherLiabilities:unknown,
  cashAndChecks:unknown,wallets:unknown,otherAssets:unknown},
};
const schedule={businessId:opening.businessId,worksheetRevisionId:opening.worksheetRevisionId,revision:'1',
 evidence:{cutoverOn:opening.cutoverOn,totals:{remainingCents:'12550'}}};

it('previews only evidenced bank and opening receivable sources with equal debit and credit totals',()=>{
 const preview=previewOpeningPosting(opening,schedule);
 expect(preview.lines).toEqual([
  {accountCode:'1000',label:'Checking',debitCents:'17005',creditCents:'0'},
  {accountCode:'1100',label:'Opening customer balances owed',debitCents:'12550',creditCents:'0'},
  {accountCode:'3000',label:'Provisional opening equity',debitCents:'0',creditCents:'29555'},
 ]);
 expect([preview.totalDebitCents,preview.totalCreditCents]).toEqual(['29555','29555']);
 expect(preview.blockers).toContain('Verify customer funds held.');
});

it('lists an overdraft and a contradictory receivables classification for review',()=>{
 const preview=previewOpeningPosting({...opening,banks:[{label:'Checking',accountCode:'1000',bookCents:'-1'}],
  controls:{...opening.controls,receivables:zero}},schedule);
 expect(preview.lines).toEqual([]);
 expect(preview.blockers).toContain('Checking has a negative book balance that needs classification before posting.');
 expect(preview.blockers).toContain('The saved receivables schedule conflicts with the worksheet’s receivables classification.');
});

it('refuses to mix a schedule with another worksheet or cutover date',()=>{
 expect(()=>previewOpeningPosting(opening,{...schedule,worksheetRevisionId:'other'})).toThrow('OPENING_POSTING_EVIDENCE_MISMATCH');
 expect(()=>previewOpeningPosting(opening,{...schedule,evidence:{...schedule.evidence,cutoverOn:'2026-02-01'}}))
  .toThrow('OPENING_POSTING_EVIDENCE_MISMATCH');
});
