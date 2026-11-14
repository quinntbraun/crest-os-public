import { describe, expect, it } from 'vitest';
import { calculateInclusiveFinanceCharge } from '../../src/bookkeeping/finance-inclusive-charge';
import { parseInvoiceIssueReadiness, parseInvoiceIssueTaxRequest, parseInvoiceIssueTaxReview } from '../../src/bookkeeping/invoice-issue-tax-review-contract';

const id = (n: number) => '182d87d1-3081-4641-a996-' + String(n).padStart(12, '0');
const reference = { draftId: id(2), revision: '3' };
const jurisdictions = { [id(4)]: 'Fictional district' };
const line = {
  outcomeId: id(4), description: 'Fictional completed work', serviceId: id(5), grossInclusiveCents: '11000',
  discountInclusiveCents: '0', inclusiveCents: '11000', complimentaryReason: null, jurisdiction: 'Fictional district',
  state: 'ready', profileId: id(6), profileVersion:'2', profileEffectiveFrom:'2026-06-01',
  availableJurisdictions: ['Fictional district'], treatment: 'inclusive_single', rate: '0.1',
  components: calculateInclusiveFinanceCharge('11000', '0', '0.1'),
};
const response = {
  schemaVersion: 1, state: 'review', businessId: id(1), ...reference, jobId: id(3), issueDate: '2026-06-01',
  dueOn: '2026-06-02', timezone: 'America/Indianapolis', lines: [line],
};

describe('invoice tax review response', () => {
  it('recomputes inclusive amounts and refuses a balanced but wrong tax split', () => {
    const request = parseInvoiceIssueTaxRequest({ ...reference, jurisdictions });
    const reviewed = parseInvoiceIssueTaxReview(response, id(1), request, request.jurisdictions);
    expect(reviewed).toMatchObject({ state: 'review', lines: [{ components: { netCents: '10000', taxCents: '1000' } }] });
    const altered = { ...response, lines: [{ ...line, components: { ...line.components, netCents: '9999', taxCents: '1001' } }] };
    expect(() => parseInvoiceIssueTaxReview(altered, id(1), request, request.jurisdictions)).toThrow();
  });

  it('requires the exact receivable, revenue and tax-mapping needs', () => {
    const request = parseInvoiceIssueTaxRequest({ ...reference, jurisdictions });
    const accountReview = { fixedMappings: { ar: { mappingId: id(7), accountId: id(8), accountCode: '1100' } },
      missingFixedPurposes: ['service_revenue'], requiredTaxJurisdictions: ['Fictional district'] };
    const parse = (value: unknown) => parseInvoiceIssueReadiness({ taxReview: response, accountReview: value }, id(1), request);
    expect(parse(accountReview).accounts).toEqual({ missing: ['service_revenue'], jurisdictions: ['Fictional district'] });
    expect(() => parse({ ...accountReview, requiredTaxJurisdictions: [] })).toThrow();
    expect(() => parse({ ...accountReview, missingFixedPurposes: ['discount'] })).toThrow();
    expect(() => parse({ ...accountReview, fixedMappings: { ar: { ...accountReview.fixedMappings.ar, accountCode: '4000' } } })).toThrow();
    const taxMapping = { mappingId: id(10), accountId: id(11), accountCode: '2100' };
    const mapped = { ...accountReview, requiredTaxJurisdictions: [], taxMappings: { 'Fictional district': taxMapping } };
    expect(parse(mapped).accounts?.taxMappings?.get('Fictional district')).toEqual({ mappingId: id(10), accountId: id(11) });
    expect(() => parse({ ...mapped, requiredTaxJurisdictions: ['Fictional district'] })).toThrow();
    expect(() => parse({ ...mapped, taxMappings: { 'Wrong district': taxMapping } })).toThrow();
    expect(() => parse({ ...mapped, taxMappings: { 'Fictional district': { ...taxMapping, accountCode: '2000' } } })).toThrow();
  });

  it('rejects unbound, duplicate and incorrectly resolved lines', () => {
    const parse = (value: unknown, chosen = jurisdictions) => parseInvoiceIssueTaxReview(value, id(1), reference, chosen);
    expect(() => parse({ ...response, revision: '4' })).toThrow();
    expect(() => parse({ ...response, lines: [line, line] })).toThrow();
    expect(() => parse({ ...response, lines: [{ ...line, profileEffectiveFrom:'2026-06-02' }] })).toThrow();
    expect(() => parse(response, { ...jurisdictions, [id(9)]: 'Extra district' })).toThrow();
    expect(() => parse({ ...response, lines: [{ ...line, treatment: 'exempt', rate: null }] })).toThrow();
    const exempt={...line,treatment:'exempt',rate:null,exemptionEvidenceId:id(12),exemptionEvidenceVersion:'1',
      components:calculateInclusiveFinanceCharge('11000','0','0')};
    expect(parse({...response,lines:[exempt]})).toMatchObject({lines:[{state:'ready',exemptionEvidenceId:id(12)}]});
    expect(()=>parse({...response,lines:[{...exempt,exemptionEvidenceVersion:'0'}]})).toThrow();
    expect(parse({ state: 'stale' })).toEqual({ state: 'stale' });
    expect(() => parseInvoiceIssueTaxRequest({ ...reference, jurisdictions: { [id(4)]: ' ' } })).toThrow();
  });
});
