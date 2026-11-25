import {expect,it} from 'vitest';
import {captureDuringAction} from '../support/quote-browser-response.mjs';

function scene(path:string,status:number,{forwardFailure,cleanupFailure}:{forwardFailure?:Error;cleanupFailure?:Error}={}){
 const bytes=Buffer.from('{"observedAt":"2026-11-20T00:00:00.000000Z","amountCents":"10025","label":"Synthetic é"}');
 const order:string[]=[],counts={forwards:0,reads:0,fulfills:0,aborts:0};
 const response={status:()=>status,async body(){counts.reads++;order.push('read');return bytes;}};
 const route={
  request:()=>({method:()=> 'POST',postDataJSON:()=>({throughOn:null})}),
  async fetch(options:unknown){expect(options).toEqual({maxRetries:0,maxRedirects:0});counts.forwards++;order.push('forward');if(forwardFailure)throw forwardFailure;return response;},
  async fulfill(value:{response:unknown;body:Buffer}){expect(value.response).toBe(response);expect(value.body).toEqual(bytes);expect(counts.reads).toBe(1);counts.fulfills++;order.push('fulfill');},
  async abort(){counts.aborts++;},
 };
 type Handler=(value:typeof route)=>Promise<void>;
 let handler:Handler|null=null;
 const page={
  async route(pattern:string,fn:Handler,options:unknown){expect(pattern).toBe('**'+path);expect(options).toEqual({times:1});expect(handler).toBeNull();handler=fn;},
  async unroute(pattern:string,fn:Handler){expect(pattern).toBe('**'+path);expect(handler).toBe(fn);handler=null;if(cleanupFailure)throw cleanupFailure;},
 };
 return {page,counts,order,bytes,registered:()=>handler!==null,async action(){const current=handler;if(!current)throw Error('SYNTHETIC_HANDLER_REQUIRED');await current(route);order.push('action-complete');}};
}

it('buffers each allowed finance read once before fulfillment, preserving actual bytes and unsuccessful status',async()=>{
 for(const name of ['customer-funds-report','receivable-aging','supplier-payable-register'])for(const status of [200,503]){
  const path='/api/business/finance-accounts/'+name,f=scene(path,status);
  const result=await captureDuringAction(f.page,path,()=>f.action(),{timeoutMs:20000});
  expect(result.status).toBe(status);expect(result.body).toEqual(JSON.parse(f.bytes.toString('utf8')));
  expect(f.counts).toEqual({forwards:1,reads:1,fulfills:1,aborts:0});expect(f.order).toEqual(['forward','read','fulfill','action-complete']);expect(f.registered()).toBe(false);
 }
});

it('preserves transport and primary-action failures while removing only its owned handler',async()=>{
 const path='/api/business/finance-accounts/supplier-payable-register',transport=Error('SYNTHETIC_TRANSPORT'),primary=Error('SYNTHETIC_PRIMARY'),cleanup=Error('SYNTHETIC_CLEANUP');
 const failed=scene(path,200,{forwardFailure:transport});
 await expect(captureDuringAction(failed.page,path,()=>failed.action())).rejects.toBe(transport);
 expect(failed.counts).toEqual({forwards:1,reads:0,fulfills:0,aborts:1});expect(failed.registered()).toBe(false);
 const cancelled=scene(path,200,{cleanupFailure:cleanup});
 await expect(captureDuringAction(cancelled.page,path,()=>{throw primary;})).rejects.toBe(primary);
 expect(cancelled.counts.forwards).toBe(0);expect(cancelled.registered()).toBe(false);
});

it('refuses finance writes before registering an observer or forwarding a request',async()=>{
 const path='/api/business/finance-accounts/supplier-payable-accrual',f=scene(path,200);
 await expect(captureDuringAction(f.page,path,()=>f.action())).rejects.toThrow('QUOTE_CAPTURE_PATH_REQUIRED');
 expect(f.counts.forwards).toBe(0);expect(f.registered()).toBe(false);
});

it('buffers the genuine review-history read once and preserves unsuccessful responses',async()=>{
 for(const status of [200,503]){
  const path='/api/business/scheduling/review-history',f=scene(path,status);
  const result=await captureDuringAction(f.page,path,()=>f.action(),{timeoutMs:20000});
  expect(result.status).toBe(status);expect(result.body).toEqual(JSON.parse(f.bytes.toString('utf8')));
  expect(f.counts).toEqual({forwards:1,reads:1,fulfills:1,aborts:0});
  expect(f.order).toEqual(['forward','read','fulfill','action-complete']);expect(f.registered()).toBe(false);
 }
});
