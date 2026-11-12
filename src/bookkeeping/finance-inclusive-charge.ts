const maximumCents = 9_223_372_036_854_775_807n;

export function isFinanceCents(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= maximumCents;
}

export function isFinanceDecimalRate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/.test(value);
}

function requireAmounts(valid: unknown): asserts valid {
  if (!valid) throw new Error('FINANCE_CENT_ALLOCATION_REVIEW_REQUIRED');
}

function roundHalfUp(numerator: bigint, denominator: bigint) {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function calculateInclusiveFinanceCharge(gross: string, discount: string, rate: string) {
  requireAmounts(isFinanceCents(gross) && isFinanceCents(discount) && isFinanceDecimalRate(rate));
  const grossAmount = BigInt(gross), discountAmount = BigInt(discount);
  requireAmounts(discountAmount <= grossAmount);
  const [whole, fraction = ''] = rate.split('.') as [string, string?];
  const scale = 10n ** BigInt(fraction.length);
  const multiplier = scale + BigInt(whole + fraction);
  const inclusive = grossAmount - discountAmount;
  const net = roundHalfUp(inclusive * scale, multiplier);
  const grossNet = roundHalfUp(grossAmount * scale, multiplier);
  return {
    grossInclusiveCents: gross,
    discountInclusiveCents: discount,
    inclusiveCents: String(inclusive),
    grossNetCents: String(grossNet),
    netCents: String(net),
    taxCents: String(inclusive - net),
    discountNetCents: String(grossNet - net),
  };
}
