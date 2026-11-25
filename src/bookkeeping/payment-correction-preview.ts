import {isFinanceCents} from './finance-inclusive-charge';
import {quoteDollarsInput} from '../commercial/quote-pricing';

/** Display-only projection of the server-reviewed, still-applied portions. */
export function previewPaymentCorrection(
  ranges:readonly Readonly<{firstCent:string;lastCent:string}>[],firstCent:string,amount:string,
){
  if(!ranges.length||ranges.length>180)return null;
  let before=0n,previousEnd=0n,selected=0n;
  for(const range of ranges){
    if(!isFinanceCents(range.firstCent)||!isFinanceCents(range.lastCent))return null;
    const first=BigInt(range.firstCent),last=BigInt(range.lastCent);
    if(first<=0n||last<first||first<=previousEnd)return null;
    const size=last-first+1n;before+=size;previousEnd=last;
    if(range.firstCent===firstCent)selected=size;
  }
  try{
    const moved=BigInt(quoteDollarsInput(amount));
    if(moved<=0n||moved>selected||!isFinanceCents(before.toString()))return null;
    return {appliedBeforeCents:before.toString(),appliedAfterCents:(before-moved).toString(),movedCents:moved.toString()};
  }catch{return null;}
}
