import type {Proof} from './authentication';
import {postScheduling} from './scheduling-transport.ts';
import {parseSchedulingOriginal,parseSchedulingOriginalResult} from '../operations/scheduling-original-contract.ts';
import {originalOperationLookupToWire} from '../security/original-operation-http-contract.ts';
export class SchedulingOriginalClientError extends Error{constructor(){super('SCHEDULING_ORIGINAL_REQUEST_FAILED');this.name='SchedulingOriginalClientError';}}
export async function lookupSchedulingOriginal(input:unknown,proof:Proof,external:AbortSignal){
 try{
  const original=parseSchedulingOriginal(input),response=await postScheduling('original',originalOperationLookupToWire(original),proof,external);if(response.status!==200)throw Error();return parseSchedulingOriginalResult(response.value,original);
 }catch{throw new SchedulingOriginalClientError();}
}
