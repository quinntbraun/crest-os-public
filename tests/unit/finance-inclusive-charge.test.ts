import { describe, expect, it } from 'vitest';
import { calculateInclusiveFinanceCharge } from '../../src/bookkeeping/finance-inclusive-charge';
import { parseFinanceTaxPreview } from '../../src/bookkeeping/finance-tax-contract';

describe('exact inclusive finance charges', () => {
  it('uses half-up arithmetic with discounts and bigint amounts', () => {
    expect(calculateInclusiveFinanceCharge('11000', '1100', '0.1')).toEqual({
      grossInclusiveCents:'11000', discountInclusiveCents:'1100', inclusiveCents:'9900', grossNetCents:'10000',
      netCents:'9000', taxCents:'900', discountNetCents:'1000',
    });
    expect(calculateInclusiveFinanceCharge('3', '0', '1').netCents).toBe('2');
    expect(calculateInclusiveFinanceCharge('9223372036854775807', '1', '0.00000000000000000000000000001').netCents)
      .toBe('9223372036854775806');
    expect(calculateInclusiveFinanceCharge('1100', '1100', '0.1')).toMatchObject({
      inclusiveCents:'0', netCents:'0', taxCents:'0', discountNetCents:'1000',
    });
  });

  it('rejects a balanced tax preview whose amounts disagree with the approved rate', () => {
    const businessId = 'e5366b7c-4694-41ad-8ca9-cc49b04ca3d7';
    const scope = { jurisdiction:'Fictional review district', applicability:'tip', serviceId:null } as const;
    const components = calculateInclusiveFinanceCharge('11000', '1100', '0.1');
    const result = { state:'ready', components, profile:{
      ...scope, businessId, schemaVersion:1, id:'892edb6a-084a-43a7-89ee-d2bdf1fca60a', version:'1',
      effectiveFrom:'2026-01-01', treatment:'inclusive_single', rate:'0.1', verificationEvidence:'Fictional rule',
      reason:'Fictional review', synthetic:true, reviewedBy:'892edb6a-084a-43a7-89ee-d2bdf1fca60b',
      auditEventId:'892edb6a-084a-43a7-89ee-d2bdf1fca60c',
    }};
    expect(parseFinanceTaxPreview(result,businessId,scope,'2026-02-01','11000','1100')).toMatchObject({components});
    const wrong = { ...result, components:{ ...components, netCents:'8999', taxCents:'901', grossNetCents:'9999' } };
    expect(() => parseFinanceTaxPreview(wrong,businessId,scope,'2026-02-01','11000','1100')).toThrow();
  });
});
