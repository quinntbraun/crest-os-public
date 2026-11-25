import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {parseFinanceAccountHistoryEvidence,parseFinanceTaxHistoryEvidence,parseMoneyChannelHistoryEvidence} from '../../src/bookkeeping/finance-history-recording';
import {FinanceHistoryRecordedTime,FinanceHistoryRecordingFacts} from '../../src/app/settings/accounts/history-recording';

const businessId=randomUUID(),accountId=randomUUID(),channelId=randomUUID(),actorId=randomUUID(),ownerActorId=randomUUID();
const recording={recordedAt:'2026-11-21T15:01:02.123456Z',actorId};
const scope={jurisdiction:'Fictional district',applicability:'tip',serviceId:null} as const;
const cases=[
 {kind:'account',parse:(value:unknown)=>parseFinanceAccountHistoryEvidence(value,businessId,accountId,'0'),body:{schemaVersion:2,businessId,accountId,hasMore:false,rows:[{schemaVersion:1,id:accountId,currency:'USD',version:'1',name:'Fictional revenue',active:true,code:'4000',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'revenue',reason:null,auditEventId:randomUUID(),recording}]}},
 {kind:'tax',parse:(value:unknown)=>parseFinanceTaxHistoryEvidence(value,businessId,scope,null),body:{schemaVersion:2,businessId,...scope,hasMore:false,rows:[{schemaVersion:1,id:randomUUID(),businessId,...scope,version:'1',effectiveFrom:'2026-01-01',treatment:'non_taxable',rate:null,verificationEvidence:'Fictional retained review',reason:'Fictional approval',synthetic:true,reviewedBy:actorId,auditEventId:randomUUID(),recording}]}},
 {kind:'channel',parse:(value:unknown)=>parseMoneyChannelHistoryEvidence(value,businessId,channelId,null),body:{schemaVersion:2,businessId,channelId,hasMore:false,rows:[{schemaVersion:1,businessId,channelId,ownerActorId,version:'1',auditEventId:randomUUID(),accountId,kind:'bank',ownershipScope:'dedicated_business',providerNamespace:'fictional-bank',maskedSuffix:'1234',label:'Fictional bank',effectiveFrom:'2026-01-01',ownershipEvidence:null,openingState:'unknown',openingOn:null,openingCents:null,openingEvidence:null,active:true,reason:'Fictional review',recording}]}},
];

it.each(cases)('retains exact recording precision and all existing $kind history facts',({body,parse})=>{
 const before=JSON.stringify(body),history=parse(body);expect(history.rows[0]!.recording).toEqual(recording);
 expect(Object.isFrozen(history.rows[0])).toBe(true);expect(Object.isFrozen(history.rows[0]!.recording)).toBe(true);
 expect(JSON.stringify(body)).toBe(before);
 expect(()=>parse({...body,schemaVersion:1})).toThrow();
});
it.each(cases)('preserves $kind tenant, exact-field, version and boundary validation',({body,parse})=>{
 for(const value of [{...body,businessId:randomUUID()},{...body,providerSubject:randomUUID()},{...body,hasMore:true},
  {...body,rows:[{...body.rows[0],version:'3'}]},
  {...body,rows:[{...body.rows[0],privatePayload:{}}]}])expect(()=>parse(value)).toThrow();
});
it.each(cases)('rejects absent, malformed and private $kind recording extensions',({body,parse})=>{
 for(const value of [undefined,null,{}, {...recording,actorId:null},{...recording,actorId:'owner@example.com'},
  {...recording,recordedAt:'2026-02-29T15:01:02.123456Z'},{...recording,recordedAt:'2026-11-21T15:01:02Z'},
  {...recording,actorName:'Unretained identity'},{...recording,providerTokens:{}}])expect(()=>parse({...body,rows:[{...body.rows[0],recording:value}]})).toThrow();
});
it('keeps the channel owner distinct from the actual recording actor',()=>{
 const channel=cases[2]!,history=channel.parse(channel.body);
 expect(history.rows[0]!.recording.actorId).toBe(actorId);expect(actorId).not.toBe(ownerActorId);
});
it('requires the recorded tax actor to agree with its retained reviewer reference',()=>{
 const tax=cases[1]!;expect(()=>tax.parse({...tax.body,rows:[{...tax.body.rows[0],recording:{...recording,actorId:randomUUID()}}]})).toThrow();
});
it('renders readable and exact UTC evidence while leaving legacy recording information explicitly unavailable',()=>{
 const visible=renderToStaticMarkup(createElement(FinanceHistoryRecordedTime,{recording}));
 expect(visible).toContain('Recorded');expect(visible).toContain('UTC');expect(visible.match(/datetime="([^"]+)"/i)?.[1]).toBe(recording.recordedAt);
 const details=renderToStaticMarkup(createElement(FinanceHistoryRecordingFacts,{recording,auditEventId:randomUUID()}));
 expect(details).toContain(recording.recordedAt);expect(details).toContain(actorId);expect(details).toContain('Recorded by reference');
 const legacy=renderToStaticMarkup(createElement(FinanceHistoryRecordingFacts,{auditEventId:randomUUID()}));
 expect(legacy).toContain('Recording time and the recording actor are not included');expect(legacy).not.toContain(actorId);
});
