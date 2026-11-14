import assert from 'node:assert/strict';
import { test } from 'vitest';
import { allocateCreditRanges, creditRangeComponents } from '../../src/bookkeeping/credit-ranges.ts';

const charge = { inclusiveCents: 6n, netCents: 5n, taxCents: 1n, discountCents: 3n };
const range = (first: bigint, last: bigint) => ({ first, last });

test('a credit after reversal of a non-last credit uses original offsets and never reverses retained tax', () => {
  const first = allocateCreditRanges(charge, [range(1n, 6n)], 3n);
  const later = allocateCreditRanges(charge, [range(4n, 6n)], 1n);
  assert.deepEqual(first.ranges, [range(1n, 3n)]);
  assert.deepEqual(later.components, { inclusiveCents: 1n, netCents: 0n, taxCents: 1n, discountCents: 0n });
  assert.deepEqual(creditRangeComponents(charge, first.ranges), first.components);

  const next = allocateCreditRanges(charge, [range(1n, 3n), range(5n, 6n)], 1n);
  assert.deepEqual(next.ranges, [range(1n, 1n)]);
  assert.deepEqual(next.components, { inclusiveCents: 1n, netCents: 1n, taxCents: 0n, discountCents: 1n });
  const spanning = allocateCreditRanges(charge, [range(2n, 3n), range(5n, 6n)], 3n);
  assert.deepEqual(spanning.ranges, [range(2n, 3n), range(5n, 5n)]);
  assert.deepEqual(creditRangeComponents(charge, spanning.ranges), spanning.components);
});

test('partial restoration selects the lowest offsets still held by the selected credit', () => {
  const credit = allocateCreditRanges(charge, [range(1n, 2n), range(4n, 6n)], 4n);
  const restored = allocateCreditRanges(charge, [range(2n, 2n), range(4n, 5n)], 2n);
  assert.deepEqual(credit.ranges, [range(1n, 2n), range(4n, 5n)]);
  assert.deepEqual(restored.ranges, [range(2n, 2n), range(4n, 4n)]);
  assert.deepEqual(restored.components, { inclusiveCents: 2n, netCents: 1n, taxCents: 1n, discountCents: 0n });
});

test('adjacent selections stay compact and all partitions conserve exact original components', () => {
  const merged = allocateCreditRanges(charge, [range(1n, 2n), range(3n, 6n)], 5n);
  assert.deepEqual(merged.ranges, [range(1n, 5n)]);
  for (let split = 1n; split < charge.inclusiveCents; split++) {
    const a = creditRangeComponents(charge, [range(1n, split)]);
    const b = creditRangeComponents(charge, [range(split + 1n, charge.inclusiveCents)]);
    for (const field of ['inclusiveCents', 'netCents', 'taxCents', 'discountCents'] as const) {
      assert.equal(a[field] + b[field], charge[field]);
    }
    assert(a.taxCents >= 0n && b.taxCents >= 0n);
  }
  const max = 9_223_372_036_854_775_807n;
  const large = { inclusiveCents: max - 7n, netCents: max - 11n, taxCents: 4n, discountCents: 7n };
  const entire = allocateCreditRanges(large, [range(1n, large.inclusiveCents)], large.inclusiveCents);
  assert.deepEqual(entire.ranges, [range(1n, large.inclusiveCents)]);
  assert.deepEqual(entire.components, large);
});

test('invalid original amounts, unsorted or duplicate ranges, and insufficient capacity are rejected', () => {
  for (const ranges of [[range(0n, 2n)], [range(2n, 1n)], [range(1n, 7n)],
    [range(1n, 3n), range(3n, 4n)], [range(3n, 4n), range(1n, 2n)]]) {
    assert.throws(() => allocateCreditRanges(charge, ranges, 1n), /CREDIT_CHARGE_RANGES_INVALID/);
  }
  assert.throws(() => allocateCreditRanges(charge, [range(4n, 6n)], 4n), /CREDIT_CHARGE_CAPACITY_EXCEEDED/);
  assert.throws(() => allocateCreditRanges(charge, [], 0n), /CREDIT_CHARGE_AMOUNT_INVALID/);
  assert.throws(() => creditRangeComponents({ ...charge, taxCents: 0n }, []), /CREDIT_CHARGE_COMPONENTS_INVALID/);
  assert.throws(() => creditRangeComponents({ inclusiveCents: 0n, netCents: 0n, taxCents: 0n, discountCents: 3n }, []),
    /CREDIT_CHARGE_COMPONENTS_INVALID/);
});
