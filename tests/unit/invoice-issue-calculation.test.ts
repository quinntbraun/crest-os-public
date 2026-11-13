import { describe, expect, it } from 'vitest';
import { calculateInvoiceIssue } from '../../src/bookkeeping/invoice-issue-calculation';

const id = (n: number) => '182d87d1-3081-4641-a996-'+String(n).padStart(12,'0');
const mapping = (n: number) => ({ accountId:id(n), versionId:id(n+100) });
const tax = { kind:'inclusive_single', rate:'0.1', profileId:id(3),
  jurisdiction:'Fictional district', effectiveFrom:'2026-01-01' } as const;
const nontaxable = { ...tax, kind:'non_taxable', rate:null } as const;
const paid = { itemId:id(1), grossInclusiveCents:'11000', discountInclusiveCents:'0',
  complimentaryReason:null, tax };
const options = { issueDate:'2026-04-22', accounts:{ar:mapping(4),discount:mapping(5),service_revenue:mapping(6)},
  taxAccounts:new Map([[tax.jurisdiction,mapping(7)]]) };
const amounts = (result: ReturnType<typeof calculateInvoiceIssue>) =>
  result.entries.map(line=>[line.purpose,line.debitCents,line.creditCents,line.mapping.versionId]);

describe('invoice issue amounts',()=>{
  it('derives the adopted inclusive and discounted posting examples with original profile and mappings',()=>{
    const taxable = calculateInvoiceIssue({ ...options, items:[paid] });
    expect(taxable.dueDate).toBe(options.issueDate);
    expect(taxable.components[0]).toMatchObject({ taxProfileId:tax.profileId, netCents:'10000', taxCents:'1000' });
    expect(amounts(taxable)).toEqual([
      ['ar','11000','0',id(104)],['service_revenue','0','10000',id(106)],['tax_payable','0','1000',id(107)],
    ]);
    const discounted = calculateInvoiceIssue({ ...options, dueDate:'2026-05-01', items:[{
      ...paid, grossInclusiveCents:'50000', discountInclusiveCents:'5000', tax:nontaxable,
    }] });
    expect(discounted.totalCents).toBe('45000');
    expect(discounted.dueDate).toBe('2026-05-01');
    expect(amounts(discounted)).toEqual([
      ['ar','45000','0',id(104)],['discount','5000','0',id(105)],['service_revenue','0','50000',id(106)],
    ]);
  });

  it('distinguishes literal zero from fully discounted work while retaining both items',()=>{
    const zero = { ...paid, tax:nontaxable, grossInclusiveCents:'0', complimentaryReason:'Fictional courtesy' };
    const literal = calculateInvoiceIssue({ ...options, items:[zero], accounts:{}, taxAccounts:new Map() });
    expect(literal.verifiedZeroEvent).toBe(true);
    expect(literal.components[0]?.itemId).toBe(zero.itemId);
    expect(literal.entries).toEqual([]);
    const fullyDiscounted = calculateInvoiceIssue({ ...options, items:[zero,{
      ...zero,itemId:id(2),grossInclusiveCents:'10000',discountInclusiveCents:'10000',
    }] });
    expect(fullyDiscounted).toMatchObject({ totalCents:'0', verifiedZeroEvent:false });
    expect(fullyDiscounted.components.map(item=>item.itemId)).toEqual([id(1),id(2)]);
    expect(amounts(fullyDiscounted)).toEqual([
      ['discount','10000','0',id(105)],['service_revenue','0','10000',id(106)],
    ]);
  });

  it('refuses missing account mappings, unproven exemptions, stale dates, duplicate IDs and overflow',()=>{
    type Item = Parameters<typeof calculateInvoiceIssue>[0]['items'][number];
    const preview = (item: Item = paid) => ({ ...options, items:[item] });
    expect(()=>calculateInvoiceIssue({ ...preview(), taxAccounts:new Map() })).toThrow();
    expect(()=>calculateInvoiceIssue({ ...preview(), dueDate:'2026-04-21' })).toThrow();
    expect(()=>calculateInvoiceIssue({ ...preview({ ...paid, tax:{ ...tax,effectiveFrom:'2026-05-01' } }) })).toThrow();
    expect(()=>calculateInvoiceIssue({ ...options, items:[{ ...paid, tax:{ ...tax,kind:'exempt',rate:null } }] })).toThrow();
    const exempt = calculateInvoiceIssue({ ...options, items:[{ ...paid,
      tax:{ ...tax,kind:'exempt',rate:null,exemptionEvidenceId:id(8) },
    }] });
    expect(exempt.components[0]).toMatchObject({ netCents:'11000', taxCents:'0' });
    expect(exempt.entries.some(line=>line.purpose==='tax_payable')).toBe(false);
    expect(()=>calculateInvoiceIssue({ ...options, items:[{ ...paid, grossInclusiveCents:'0' }] })).toThrow();
    expect(()=>calculateInvoiceIssue({ ...options, items:[paid,paid] })).toThrow();
    expect(()=>calculateInvoiceIssue({ ...options, items:[paid,{
      ...paid,itemId:id(2),grossInclusiveCents:'9223372036854775807',
    }] })).toThrow();
  });
});
