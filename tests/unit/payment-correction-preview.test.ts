import {expect,it} from 'vitest';
import {previewPaymentCorrection} from '../../src/bookkeeping/payment-correction-preview';

it('compares only still-applied portions after earlier corrections without inventing a customer or invoice balance',()=>{
  const ranges=[{firstCent:'1',lastCent:'2500'},{firstCent:'5001',lastCent:'10000'}];
  const before=structuredClone(ranges);
  expect(previewPaymentCorrection(ranges,'5001','25.00')).toEqual({appliedBeforeCents:'7500',appliedAfterCents:'5000',movedCents:'2500'});
  expect(ranges).toEqual(before);
});
it('does not combine disconnected portions to make an unavailable correction look valid',()=>{
  expect(previewPaymentCorrection([{firstCent:'1',lastCent:'100'},{firstCent:'201',lastCent:'300'}],'1','1.01')).toBeNull();
});
it('handles a full remaining application and exact large cents without floating point',()=>{
  expect(previewPaymentCorrection([{firstCent:'1',lastCent:'1234'}],'1','12.34')?.appliedAfterCents).toBe('0');
  expect(previewPaymentCorrection([{firstCent:'9007199254740993',lastCent:'9007199254741093'}],'9007199254740993','0.01'))
    .toEqual({appliedBeforeCents:'101',appliedAfterCents:'100',movedCents:'1'});
});
it.each(['','0','-1','1.001','1e2','NaN','1,000.00'])('withholds a misleading preview for invalid amount %s',amount=>{
  expect(previewPaymentCorrection([{firstCent:'1',lastCent:'100000'}],'1',amount)).toBeNull();
});
it('withholds malformed, overlapping and missing selections',()=>{
  for(const ranges of [[],[{firstCent:'0',lastCent:'100'}],[{firstCent:'2',lastCent:'1'}],
    [{firstCent:'1',lastCent:'100'},{firstCent:'100',lastCent:'200'}],[{firstCent:'x',lastCent:'100'}]])
    expect(previewPaymentCorrection(ranges,'1','0.01')).toBeNull();
  expect(previewPaymentCorrection([{firstCent:'1',lastCent:'100'}],'2','0.01')).toBeNull();
});
