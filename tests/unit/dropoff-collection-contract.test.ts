import {describe,it,expect} from 'vitest';
import {parseCollectionCursor,parseCollectionPage,parsePickupReturnPage} from '../../src/operations/dropoff-collection-contract';

const business='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const instant='2026-11-03T09:45:00.123456Z';
const cursor={afterReceivedAt:null,afterCaseId:null};
const row=(id:number)=>({caseId:'00000000-0000-4000-8000-'+String(id).padStart(12,'0'),
 jobId:business,jobVehicleId:other,receivedAt:instant,state:'awaiting_collection',
 vehicleLabel:'Synthetic sedan',customerName:'Synthetic customer'});
const page=(rows:unknown[],hasMore=false)=>({schemaVersion:1,businessId:business,rows,hasMore});

describe('private collection pages',()=>{
 it('keeps equal-time rows in stable order across a page boundary',()=>{
  const first=parseCollectionPage(page(Array.from({length:25},(_,i)=>row(i+1)),true),business,cursor);
  const last=first.rows.at(-1)!;
  const second=parseCollectionPage(page([row(26)]),business,{afterReceivedAt:last.receivedAt,afterCaseId:last.caseId});
  expect(first.hasMore).toBe(true);
  expect(second.rows[0]!.caseId).toBe(row(26).caseId);
 });
 it('rejects a foreign business and an incomplete continuation marker',()=>{
  expect(()=>parseCollectionPage(page([row(1)]),other,cursor)).toThrow();
  expect(()=>parseCollectionCursor({afterReceivedAt:instant,afterCaseId:null})).toThrow();
 });
 it('rejects repeated case IDs and rows preceding the requested marker',()=>{
  expect(()=>parseCollectionPage(page([row(1),row(1)]),business,cursor)).toThrow();
  expect(()=>parseCollectionPage(page([row(1)]),business,{afterReceivedAt:instant,afterCaseId:row(2).caseId})).toThrow();
 });
 it('refuses incomplete pages that claim more results and unexpected private fields',()=>{
  expect(()=>parseCollectionPage(page([row(1)],true),business,cursor)).toThrow();
  expect(()=>parseCollectionPage(page([{...row(1),notes:'Unrequested private evidence'}]),business,cursor)).toThrow();
 });
 it('admits only unresolved pickup return states in the pickup queue',()=>{
  const states=['awaiting_return','returning','ready_for_handoff','return_stopped','return_failed'];
  expect(parsePickupReturnPage(page(states.map((state,i)=>({...row(i+1),state}))),business,cursor).rows.map(item=>item.state)).toEqual(states);
  for(const state of ['released','awaiting_collection','return_required']){
   expect(()=>parsePickupReturnPage(page([{...row(1),state}]),business,cursor)).toThrow();
  }
  expect(()=>parseCollectionPage(page([{...row(1),state:'return_failed'}]),business,cursor)).toThrow();
  expect(()=>parsePickupReturnPage(page([{...row(1),state:'return_failed',reason:'Private reason'}]),business,cursor)).toThrow();
 });
 it('accepts both held return states and refuses released vehicles',()=>{
  expect(parseCollectionPage(page([{...row(1),state:'return_required'}]),business,cursor).rows[0]!.state).toBe('return_required');
  expect(()=>parseCollectionPage(page([{...row(1),state:'released'}]),business,cursor)).toThrow();
 });
});
