import {it,expect} from 'vitest';
import {financePostingSchema} from '../../src/bookkeeping/finance-posting-schema';
import {postedFinanceProfileForSchema} from '../../src/security/posted-finance-owner-export-contract';
it('adopts only reviewed financial vocabulary and refuses unknown export schemas',()=>{
 for(let version=109;version<=134;version++){
  expect(financePostingSchema(version)).toBe(109);
  expect(postedFinanceProfileForSchema(version)).toBe('crest.posted-finance-source.v23');
 }
 for(const version of [0,88,135,999,NaN,Infinity,109.5])expect(()=>postedFinanceProfileForSchema(version)).toThrow('POSTED_FINANCE_EXPORT_CONFIGURATION_REQUIRED');
 expect(financePostingSchema(135)).toBe(135);
 expect(postedFinanceProfileForSchema(89)).toBe('crest.posted-finance-source.v7');
});
