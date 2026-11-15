// ACCOUNTING §§7 and 24.1. The posting transaction owns source binding,
// locking, eligibility and retention. These calculations do not claim ranges.
export type ChargeComponents = Readonly<{
  inclusiveCents: bigint;
  netCents: bigint;
  taxCents: bigint;
  discountCents: bigint;
}>;

export type ChargeRange = Readonly<{ first: bigint; last: bigint }>;

const maxCents = 9_223_372_036_854_775_807n;

function assertCharge(charge: ChargeComponents) {
  const { inclusiveCents, netCents, taxCents, discountCents } = charge;
  if (inclusiveCents <= 0n || netCents < 0n || taxCents < 0n || discountCents < 0n
    || netCents + taxCents !== inclusiveCents || inclusiveCents + discountCents > maxCents) {
    throw new Error('CREDIT_CHARGE_COMPONENTS_INVALID');
  }
}

function assertRanges(ranges: readonly ChargeRange[], limit: bigint) {
  let previous = 0n;
  for (const { first, last } of ranges) {
    if (first <= previous || last < first || last > limit) {
      throw new Error('CREDIT_CHARGE_RANGES_INVALID');
    }
    previous = last;
  }
}

function components(charge: ChargeComponents, ranges: readonly ChargeRange[]): ChargeComponents {
  const total = charge.inclusiveCents;
  const prefix = (value: bigint, offset: bigint) => (2n * value * offset + total) / (2n * total);
  let inclusiveCents = 0n;
  let netCents = 0n;
  let discountCents = 0n;
  for (const { first, last } of ranges) {
    const before = first - 1n;
    inclusiveCents += last - before;
    netCents += prefix(charge.netCents, last) - prefix(charge.netCents, before);
    discountCents += prefix(charge.discountCents, last) - prefix(charge.discountCents, before);
  }
  return Object.freeze({ inclusiveCents, netCents, taxCents: inclusiveCents - netCents, discountCents });
}

/** Calculate the exact components of saved ranges on their original charge. */
export function creditRangeComponents(charge: ChargeComponents, ranges: readonly ChargeRange[]): ChargeComponents {
  assertCharge(charge);
  assertRanges(ranges, charge.inclusiveCents);
  return components(charge, ranges);
}

/** Select the lowest eligible offsets on one charge or one credit being reversed. */
export function allocateCreditRanges(charge: ChargeComponents, eligible: readonly ChargeRange[], amount: bigint) {
  assertCharge(charge);
  assertRanges(eligible, charge.inclusiveCents);
  if (amount <= 0n || amount > charge.inclusiveCents) throw new Error('CREDIT_CHARGE_AMOUNT_INVALID');

  const selected: ChargeRange[] = [];
  let remaining = amount;
  for (const { first, last } of eligible) {
    if (remaining === 0n) break;
    const length = last - first + 1n;
    const take = remaining < length ? remaining : length;
    const end = first + take - 1n;
    const previous = selected.at(-1);
    if (previous && previous.last + 1n === first) {
      selected[selected.length - 1] = Object.freeze({ first: previous.first, last: end });
    } else {
      selected.push(Object.freeze({ first, last: end }));
    }
    remaining -= take;
  }
  if (remaining !== 0n) throw new Error('CREDIT_CHARGE_CAPACITY_EXCEEDED');
  return Object.freeze({ ranges: Object.freeze(selected), components: components(charge, selected) });
}
